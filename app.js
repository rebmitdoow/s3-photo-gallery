require("dotenv").config();
const express = require("express");
const AWS = require("aws-sdk");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 5500;

const db = new sqlite3.Database("./database.db");

app.use(express.json());

AWS.config.update({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const s3 = new AWS.S3();
const upload = multer();

const SECRET_KEY = process.env.SECRET_KEY;

app.use(express.static(path.join(__dirname, "public")));
app.use("/css", express.static(path.join(__dirname, "public/css")));
app.use("/js", express.static(path.join(__dirname, "public/js")));

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).send("Unauthorized: No token provided");
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).send("Unauthorized: Invalid or expired token");
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

app.get("/upload", (req, res) => {
  res.sendFile(path.join(__dirname, "public/upload.html"));
});

app.get("/gallerie", (req, res) => {
  res.sendFile(path.join(__dirname, "public/grid.html"));
});

app.get("/api/images", async (req, res) => {
  const folderPath = req.query.id;
  if (!folderPath) {
    return res.status(400).json({ error: "id query parameter is required" });
  }

  const bucketName = process.env.AWS_BUCKET_NAME;
  const params = {
    Bucket: bucketName,
    Prefix: `${folderPath}/thumbnails/`,
  };

  try {
    const data = await s3.listObjectsV2(params).promise();
    const imageUrls = data.Contents.map((item) => {
      return `https://${bucketName}.${process.env.AWS_ENDPOINT}/${item.Key}`;
    }).filter((url) => !url.endsWith(".blank"));
    res.json({ images: imageUrls });
  } catch (err) {
    console.error("Error fetching S3 files:", err);
    res.status(500).json({ error: "Failed to fetch images" });
  }
});

app.post(
  "/api/upload",
  authenticate,
  upload.single("file"),
  async (req, res) => {
    const { folderPath, fileName, albumName } = req.query;
    if (!req.file || !folderPath || !fileName || !albumName) {
      return res
        .status(400)
        .json({ error: "Missing required parameters or file" });
    }
    const bucketName = process.env.AWS_BUCKET_NAME;
    const s3Key = `${folderPath.replace(/\\/g, "/")}/${fileName}`;
    try {
      await s3
        .upload({
          Bucket: bucketName,
          Key: s3Key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
          ACL: "public-read",
        })
        .promise();
      const settingsParams = {
        Bucket: bucketName,
        Key: "settings.json",
      };
      const data = await s3.getObject(settingsParams).promise();
      const settings = JSON.parse(data.Body.toString());
      if (!Array.isArray(settings.albums)) {
        settings.albums = [];
      }
      const albumExists = settings.albums.some(
        (album) => album.album_name === albumName
      );

      if (!albumExists) {
        settings.albums.push({ album_name: albumName });
        await s3
          .putObject({
            Bucket: bucketName,
            Key: "settings.json",
            Body: JSON.stringify(settings, null, 2),
            ContentType: "application/json",
          })
          .promise();
      }
      res
        .status(200)
        .json({ message: "File uploaded and album updated successfully" });
    } catch (err) {
      console.error("Error uploading to S3 or updating settings:", err);
      res.status(500).json({ error: "Failed to upload file or update album" });
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

app.get("/api/albums", authenticate, async (req, res) => {
  const bucketName = process.env.AWS_BUCKET_NAME;
  const params = {
    Bucket: bucketName,
    Key: "settings.json",
  };

  try {
    const data = await s3.getObject(params).promise();
    const settings = JSON.parse(data.Body.toString());
    if (Array.isArray(settings.albums)) {
      const albums = settings.albums.map((album) => album.album_name);
      res.status(200).json({ albums });
    } else {
      res
        .status(400)
        .json({ error: "'albums' key not found or is not an array" });
    }
  } catch (err) {
    console.error("Error fetching settings from S3:", err);
    res.status(500).json({ error: "Failed to fetch albums" });
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
