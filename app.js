require("dotenv").config();
const express = require("express");
const AWS = require("aws-sdk");
const multer = require("multer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5500;

AWS.config.update({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const s3 = new AWS.S3();
const upload = multer();

app.use(express.static(path.join(__dirname, "public")));
app.use("/css", express.static(path.join(__dirname, "public/css")));
app.use("/js", express.static(path.join(__dirname, "public/js")));

app.get("/", (req, res) => {
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

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const { folderPath, fileName } = req.query;
  if (!req.file || !folderPath || !fileName) {
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
    res.status(200).json({ message: "File uploaded successfully" });
  } catch (err) {
    console.error("Error uploading to S3:", err);
    res.status(500).json({ error: "Failed to upload file to S3" });
  }
});

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

app.get("/api/albums", async (req, res) => {
  const bucketName = process.env.AWS_BUCKET_NAME;
  const params = {
    Bucket: bucketName,
    Delimiter: "/",
  };
  try {
    const data = await s3.listObjectsV2(params).promise();
    const albums = data.CommonPrefixes.map((prefix) => prefix.Prefix);
    res.status(200).json({ albums });
  } catch (err) {
    console.error("Error fetching albums from S3:", err);
    res.status(500).json({ error: "Failed to fetch albums" });
  }
});

app.get("/api/settings", async (req, res) => {
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
