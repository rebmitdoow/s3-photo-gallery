let baseUrl = "";

$(document).ready(function () {
  const token = localStorage.getItem("authToken");

  if (!token) {
    window.location.href = "/login";
    return;
  }

  $.ajax({
    url: "/api/config",
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    success: function (response) {
      baseUrl = response.baseUrl;
    },
    error: function () {
      alert("Failed to fetch configuration.");
    },
  });
});

function resizeImage(file, maxDimension, callback) {
  const reader = new FileReader();
  reader.onload = function (event) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      let width = img.width;
      let height = img.height;

      if (width > height && width > maxDimension) {
        height = (maxDimension / width) * height;
        width = maxDimension;
      } else if (height > width && height > maxDimension) {
        width = (maxDimension / height) * width;
        height = maxDimension;
      }

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(callback, "image/jpeg", 0.8);
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

$(document).ready(function () {
  const token = localStorage.getItem("authToken");

  if (!token) {
    window.location.href = "/login";
    return;
  }
});

$(document).ready(function () {
  const dropZone = $("#imageFilesDropZone");
  const fileInput = $("#imageFiles");
  const uploadButton = $("#uploadButton");

  dropZone.on("dragover", (event) => {
    event.preventDefault();
    dropZone.addClass("drag-over");
  });

  dropZone.on("dragleave", () => {
    dropZone.removeClass("drag-over");
  });

  dropZone.on("drop", (event) => {
    event.preventDefault();
    dropZone.removeClass("drag-over");
    fileInput[0].files = event.originalEvent.dataTransfer.files;
    displayFileList(fileInput[0].files);
  });

  $("#addFilesButton").on("click", () => {
    fileInput.click();
  });

  fileInput.on("change", () => {
    displayFileList(fileInput[0].files);
  });

  function displayFileList(files) {
    const fileListContainer = $("<ul>").attr("id", "fileListContainer");
    dropZone.empty();
    dropZone.append(fileListContainer);

    if (files.length > 0) {
      Array.from(files).forEach((file) => {
        const listItem = $("<li class='fileName'>")
          .text(file.name)
          .append('<span class="status">⏳</span>');
        fileListContainer.append(listItem);
      });
    } else {
      dropZone.append(
        "<p>Glisser des photos ou <button id='addFilesButton' type='button'>cliquer ici</button></p>"
      );
    }
    dropZone.append($("#addFilesButton"));
  }

  uploadButton.on("click", async () => {
    const rootFolder = $("#rootFolder").val().trim().replace(/\\/g, "/");
    const files = fileInput[0].files;

    if (!rootFolder) {
      alert("Veuillez entrer un nom d'album.");
      return;
    }

    if (files.length === 0) {
      alert("Veuillez sélectionner au moins une image à télécharger.");
      return;
    }

    const progressContainer = $("#progressContainer");
    const progressBar = $("#uploadProgress");
    const progressText = $("#progressText");
    uploadButton.prop("disabled", true);
    uploadButton.html(`<span class="loader"></span> Chargement...`);
    progressContainer.show();
    progressBar.val(0);
    progressText.text("0%");

    const totalFiles = files.length;
    let uploadedFiles = 0;
    const albumExists = await checkIfAlbumExists(rootFolder);
    if (albumExists) {
      alert("Cet album existe déjà !");
      uploadButton.prop("disabled", false);
      uploadButton.text("Ajouter");
      return;
    }

    async function checkIfAlbumExists(albumName) {
      try {
        const token = localStorage.getItem("authToken");
        const response = await fetch("/api/albums", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          throw new Error(
            `Error checking album existence: ${response.statusText}`
          );
        }
        const data = await response.json();
        const existingAlbums = data.albums || [];
        return existingAlbums.some((album) => album.album_name === albumName);
      } catch (err) {
        console.error("Error checking album existence:", err);
        alert("Une erreur est survenue lors de la vérification de l'album.");
        return false;
      }
    }

    async function uploadFile(blob, fileName, folderPath, albumName) {
      folderPath = folderPath.replace(/\\/g, "/");
      const uploadUrl = `/api/upload?folderPath=${encodeURIComponent(
        folderPath
      )}&fileName=${encodeURIComponent(
        fileName
      )}&albumName=${encodeURIComponent(albumName)}`;
      const formData = new FormData();
      formData.append("file", blob);
      const token = localStorage.getItem("authToken");
      await fetch(uploadUrl, {
        method: "POST",
        body: formData,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const listItem = $(`#fileListContainer li:eq(${i})`);
      const statusSpan = listItem.find(".status");

      try {
        await new Promise((resolve, reject) => {
          resizeImage(file, 600, async (blob) => {
            try {
              await uploadFile(
                blob,
                `thumbnails/${file.name}`,
                rootFolder,
                rootFolder
              );
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        await new Promise((resolve, reject) => {
          resizeImage(file, 1920, async (blob) => {
            try {
              await uploadFile(blob, file.name, rootFolder, rootFolder);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        uploadedFiles++;
        statusSpan.text("✔️");
        const progressPercentage = Math.round(
          (uploadedFiles / totalFiles) * 100
        );
        progressBar.val(progressPercentage);
        progressText.text(`${progressPercentage}%`);
      } catch (error) {
        console.error(`Échec du téléchargement de ${file.name}:`, error);
        statusSpan.text("❌");
      }
    }

    progressContainer.hide();

    if (uploadedFiles === totalFiles) {
      uploadButton.text("Terminé");

      const albumLink = `${baseUrl}/gallerie?id=${encodeURIComponent(
        rootFolder
      )}`;

      $("#linkContainer").html(`
        <div class="album-link-container">
          <label for="albumLink">Lien de l'album :</label>
          <div class="input-with-icon">
            <input id="albumLink" type="text" value="${albumLink}" readonly />
            <button type="button" id="copyButton" class="copy-icon" title="Copier">
              📋
            </button>
          </div>
        </div>
      `);
      $("#copyButton").on("click", async () => {
        try {
          await navigator.clipboard.writeText(albumLink);
          alert("Lien copié dans le presse-papier !");
        } catch (err) {
          console.error("Échec de la copie du lien :", err);
          alert("Impossible de copier le lien.");
        }
      });
    } else {
      alert("Certains fichiers n'ont pas pu être téléchargés.");
      uploadButton.prop("disabled", false);
      uploadButton.text("Ajouter");
    }
  });
});
