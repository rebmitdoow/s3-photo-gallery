require("dotenv").config();
const express = require("express");
const { Upload } = require("@aws-sdk/lib-storage");
const { S3, S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
const path = require("path");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");

const crypto = require("crypto");

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY),
    iv
  );
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(text) {
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift(), "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY),
    iv
  );
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

const app = express();
const PORT = process.env.PORT || 5500;

const db = new sqlite3.Database("./database.db");

app.use(express.json());

const s3 = new S3();
const upload = multer();

const SECRET_KEY = process.env.SECRET_KEY;

app.use(express.static(path.join(__dirname, "public")));
app.use("/css", express.static(path.join(__dirname, "public/css")));
app.use("/js", express.static(path.join(__dirname, "public/js")));

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  /* console.log("token from auth", token); */
  if (!token) {
    console.error("No token provided in request");
    return res.status(401).send("Unauthorized: No token provided");
  }
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    /* console.log("Decoded token:", decoded); */
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Invalid or expired token:", err.message);
    return res.status(403).send("Unauthorized: Invalid or expired token");
  }
};

const getS3CredentialsMiddleware = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      console.error("User ID missing in request");
      return res.status(400).send("User ID is missing from request.");
    }

    /* console.log("Fetching S3 credentials for user ID:", userId); */

    db.get(
      `SELECT s3_name, s3_endpoint, s3_access_key_id, s3_secret_access_key, s3_region FROM users WHERE id = ?`,
      [userId],
      (err, user) => {
        if (err) {
          console.error("Database error:", err.message);
          return res
            .status(500)
            .json({ error: "Database error.", details: err.message });
        }

        if (
          user &&
          user.s3_name &&
          user.s3_access_key_id &&
          user.s3_secret_access_key &&
          user.s3_region &&
          user.s3_endpoint
        ) {
          const userS3 = new S3Client({
            region: user.s3_region,
            credentials: {
              accessKeyId: user.s3_access_key_id,
              secretAccessKey: decrypt(user.s3_secret_access_key),
            },
            endpoint: user.s3_endpoint,
          });
          /*  console.log("User S3 credentials found:", userS3); */
          req.userS3 = userS3;
          req.userBucketName = user.s3_name;
          req.userS3Endpoint = user.s3_endpoint;
          return next();
        } else {
          console.log(
            "User S3 credentials missing; redirecting to set credentials page"
          );
          return res.status(302).json({ redirect: "/s3Form" });
        }
      }
    );
  } catch (err) {
    console.error("Unexpected server error:", err.message);
    return res
      .status(500)
      .json({ error: "Server error.", details: err.message });
  }
};

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required." });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (username, password) VALUES (?, ?)`,
    [username, hashedPassword],
    function (err) {
      if (err) {
        if (err.code === "SQLITE_CONSTRAINT") {
          return res.status(400).json({ error: "Username already exists." });
        }
        return res
          .status(500)
          .json({ error: "Database error.", details: err.message });
      }
      res.status(201).json({ message: "User registered successfully." });
    }
  );
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required." });
  }

  db.get(
    `SELECT * FROM users WHERE username = ?`,
    [username],
    async (err, user) => {
      if (err) {
        return res
          .status(500)
          .json({ error: "Database error.", details: err.message });
      }

      if (!user) {
        return res.status(400).json({ error: "Invalid username or password." });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(400).json({ error: "Invalid username or password." });
      }

      const token = jwt.sign(
        { id: user.id, username: user.username },
        SECRET_KEY,
        { expiresIn: "1h" }
      );
      res.status(200).json({ message: "Login successful.", token });
    }
  );
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public/login.html"));
});

app.get("/", authenticate, (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.get("/api/config", authenticate, (req, res) => {
  const config = {
    baseUrl: process.env.BASE_URL || `http://localhost:${PORT}`,
  };
  res.status(200).json(config);
});

app.get(
  "/api/albums",
  authenticate,
  getS3CredentialsMiddleware,
  async (req, res) => {
    const bucketName = req.userBucketName;
    /* console.log("bucketName", bucketName); */
    const params = {
      Bucket: bucketName,
      Key: "settings.json",
    };
    try {
      const command = new GetObjectCommand(params);
      const data = await req.userS3.send(command);
      /*  console.log("data", data); */
      const body = await streamToString(data.Body);
      const settings = JSON.parse(body);
      const albums = settings.albums
        .filter((album) => album.album_name)
        .map((album) => ({
          album_name: album.album_name,
          is_private: album.is_private || false,
          cover_key: album.cover_key || "",
        }));
      return res.status(200).json({ albums });
    } catch (err) {
      console.error("Error fetching settings from S3:", err);
      return res.status(500).json({ error: "Failed to fetch albums." });
    }
  }
);
const streamToString = (stream) => {
  return new Promise((resolve, reject) => {
    let data = "";
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("end", () => {
      resolve(data);
    });
    stream.on("error", reject);
  });
};

app.get(
  "/s3Form",
  /* authenticate , */ (req, res) => {
    console.log("User is being redirected to set S3 credentials page.");
    res.sendFile(path.join(__dirname, "public/s3Form.html"));
  }
);

app.post("/api/user/s3-credentials", authenticate, (req, res) => {
  const {
    s3_name,
    s3_access_key_id,
    s3_secret_access_key,
    s3_region,
    s3_endpoint,
  } = req.body;
  const userId = req.user.id;
  console.log("userId", userId);

  if (
    !s3_name ||
    !s3_access_key_id ||
    !s3_secret_access_key ||
    !s3_region ||
    !s3_endpoint
  ) {
    return res.status(400).json({ error: "AWS credentials are required." });
  }

  const encryptedSecretKey = encrypt(s3_secret_access_key);

  db.run(
    `UPDATE users SET s3_name = ?, s3_access_key_id = ?, s3_secret_access_key = ?, s3_region = ?, s3_endpoint = ? WHERE id = ?`,
    [
      s3_name,
      s3_access_key_id,
      encryptedSecretKey,
      s3_region,
      s3_endpoint,
      userId,
    ],
    function (err) {
      if (err) {
        return res
          .status(500)
          .json({ error: "Database error.", details: err.message });
      }
      res
        .status(200)
        .json({ message: "AWS credentials updated successfully." });
    }
  );
});

app.get("/upload", (req, res) => {
  res.sendFile(path.join(__dirname, "public/upload.html"));
});

app.post(
  "/api/upload",
  authenticate,
  getS3CredentialsMiddleware,
  multer().single("file"),
  async (req, res) => {
    const { folderPath, fileName } = req.query;
    if (!req.file || !folderPath || !fileName) {
      return res
        .status(400)
        .json({ error: "Missing required parameters or file" });
    }

    db.get(
      `SELECT s3_access_key_id, s3_secret_access_key, s3_region FROM users WHERE id = ?`,
      [req.user.id],
      async (err, user) => {
        if (err) {
          return res
            .status(500)
            .json({ error: "Database error.", details: err.message });
        }

        if (
          !user ||
          !user.s3_name ||
          !user.s3_access_key_id ||
          !user.s3_secret_access_key ||
          !user.s3_region ||
          !user.s3_endpoint
        ) {
          return res
            .status(400)
            .json({ error: "AWS credentials are not set." });
        }

        const userS3 = new S3({
          bucketName: user.s3_name,
          accessKeyId: user.s3_access_key_id,
          secretAccessKey: user.s3_secret_access_key,
          region: user.s3_region,
          endpoint: user.s3_endpoint,
        });

        const s3Key = `${folderPath.replace(/\\/g, "/")}/${fileName}`;
        try {
          await userS3
            .upload({
              Bucket: bucketName,
              Key: s3Key,
              Body: req.file.buffer,
              ContentType: req.file.mimetype,
              ACL: "public-read",
            })
            .promise();

          res.status(200).json({ message: "File uploaded successfully" });
        } catch (err) {
          console.error("Error uploading to S3:", err);
          res.status(500).json({ error: "Failed to upload file" });
        }
      }
    );
  }
);

app.get("/gallerie", (req, res) => {
  res.sendFile(path.join(__dirname, "public/grid.html"));
});

app.get(
  "/api/images",
  authenticate,
  getS3CredentialsMiddleware,
  async (req, res) => {
    const folderPath = req.query.id;
    if (!folderPath) {
      return res.status(400).json({ error: "id query parameter is required" });
    }

    const bucketName = req.userBucketName;

    const params = {
      Bucket: bucketName,
      Prefix: `${folderPath}/thumbnails/`,
    };

    try {
      const command = new ListObjectsV2Command(params);
      const data = await req.userS3.send(command);

      const baseUrl = `https://${bucketName}.${
        new URL(req.userS3Endpoint).host
      }`;

      const imageUrls = (data.Contents || [])
        .map((item) => `${baseUrl}/${item.Key}`)
        .filter((url) => !url.endsWith(".blank"));

      res.json({ images: imageUrls });
    } catch (err) {
      console.error("Error fetching S3 files:", err);
      res.status(500).json({ error: "Failed to fetch images" });
    }
  }
);

app.get("/api/download", async (req, res) => {
  const { key } = req.query;
  if (!key) {
    return res
      .status(400)
      .json({ error: "imageUrl query parameter is required" });
  }
  const bucketUrlPrefix = `https://${process.env.AWS_BUCKET_NAME}.${process.env.AWS_ENDPOINT}/`;
  const bucketName = process.env.AWS_BUCKET_NAME;
  const params = {
    Bucket: bucketName,
    Key: key,
  };
  try {
    const data = await s3.getObject(params).promise();
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${path.basename(bucketUrlPrefix + key)}`
    );
    res.setHeader("Content-Type", data.ContentType);
    res.send(data.Body);
  } catch (err) {
    console.error("Error fetching file from S3:", err);
    res.status(500).json({ error: "Failed to download image" });
  }
});

app.get("/api/settings", authenticate, async (req, res) => {
  const bucketName = process.env.AWS_BUCKET_NAME;
  const params = {
    Bucket: bucketName,
    Key: "settings.json",
  };
  try {
    const data = await s3.getObject(params).promise();
    const settings = JSON.parse(data.Body.toString());
    res.status(200).json(settings);
  } catch (err) {
    console.error("Error fetching settings from S3:", err);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
