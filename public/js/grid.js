const token = localStorage.getItem("authToken");
var imageUrls = [];

// In memory cache
const imageCache = {};

const modal = $("#imageModal");
const modalImg = $("#modalImage");

function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

$(document).ready(function () {
  const folderPath = getQueryParam("id");
  if (!folderPath) {
    alert("id is required!");
    return;
  }

  const pathParts = folderPath.split("/");
  const folderName = pathParts.pop();

  document.title = folderName;
  $(".path-title").text(`${folderName}`);

  const MIN_ROW_HEIGHT = 150;
  const MAX_ROW_HEIGHT = 300;

  const images = [];
  const grid = $(".photo-grid");

  function arrangeImages() {
    const viewportWidth = grid.width();
    const singleRowMode = window.innerWidth <= 500;

    let currentRow = [];
    let currentRowWidth = 0;

    images.forEach((imgObj, index) => {
      const aspectRatio = imgObj.width / imgObj.height;

      if (singleRowMode) {
        imgObj.card.css({
          width: "100%",
          height: "auto",
        });
        return;
      }

      const targetHeight = Math.min(
        MAX_ROW_HEIGHT,
        Math.max(MIN_ROW_HEIGHT, viewportWidth / aspectRatio)
      );
      const imgWidth = targetHeight * aspectRatio;

      currentRowWidth += imgWidth;
      currentRow.push(imgObj);

      if (currentRowWidth > viewportWidth || index === images.length - 1) {
        const isLastRow = index === images.length - 1;

        if (!isLastRow) {
          const scaleFactor = Math.min(1, viewportWidth / currentRowWidth);
          const rowHeight = Math.max(
            MIN_ROW_HEIGHT,
            Math.min(MAX_ROW_HEIGHT, targetHeight * scaleFactor)
          );

          currentRow.forEach(({ card, width, height }) => {
            const scaledWidth = rowHeight * (width / height);

            card.css({
              width: `${scaledWidth}px`,
              height: `${rowHeight}px`,
            });
          });
        } else {
          currentRow.forEach(({ card, width, height }) => {
            const naturalHeight = Math.min(
              MAX_ROW_HEIGHT,
              Math.max(MIN_ROW_HEIGHT, height)
            );
            const naturalWidth = naturalHeight * (width / height);

            card.css({
              width: `${naturalWidth}px`,
              height: `${naturalHeight}px`,
            });
          });
        }

        currentRow = [];
        currentRowWidth = 0;
      }
    });
  }

  $.ajax({
    url: `/api/images?id=${encodeURIComponent(folderPath)}`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    success: function (response) {
      const imageData = response.images || [];
      imageData.forEach(function (fileUrl) {
        const fullSizeUrl = fileUrl.replace("/thumbnails", "");
        imageUrls.push(fullSizeUrl);

        if (imageCache[fileUrl]) {
          const cachedData = imageCache[fileUrl];
          const card = $("<div>").addClass("card");
          const image = $("<img>")
            .attr("src", cachedData.fileUrl)
            .attr("alt", "Image")
            .attr("loading", "lazy")
            .css({ display: "block", width: "100%", height: "auto" });
          card.append(image);

          grid.append(card);

          images.push({
            card,
            width: cachedData.width,
            height: cachedData.height,
          });

          arrangeImages();
        } else {
          const img = new Image();

          img.onload = function () {
            const card = $("<div>").addClass("card");
            const image = $("<img>")
              .attr("src", fileUrl)
              .attr("alt", "Image")
              .attr("loading", "lazy")
              .css({ display: "block", width: "100%", height: "auto" });
            card.append(image);
            grid.append(card);

            const imgData = {
              card,
              width: img.naturalWidth,
              height: img.naturalHeight,
            };
            images.push(imgData);
            imageCache[fileUrl] = {
              fileUrl,
              width: img.naturalWidth,
              height: img.naturalHeight,
            };
            arrangeImages();
          };

          img.onerror = function () {
            console.error(`Failed to load image: ${fileUrl}`);
          };

          img.src = fileUrl;
        }
      });
    },
    error: function (err) {
      console.error("Error fetching images from server:", err);
      alert("Failed to load images. Please try again later.");
    },
  });

  $(window).on("resize", arrangeImages);

  $(".photo-grid").on("mouseenter", ".card", function () {
    const thumbnailUrl = $(this).find("img").attr("src");
    const fullSizeUrl = thumbnailUrl.replace("/thumbnails", "");
    if (!imageCache[fullSizeUrl]) {
      preloadImage(fullSizeUrl);
    }
  });

  let currentIndex = 0;

  $(".photo-grid").on("click", ".card", function (event) {
    event.preventDefault();
    event.stopPropagation();

    const thumbnailUrl = $(this).find("img").attr("src");
    const largeImageUrl = thumbnailUrl.replace("/thumbnails", "");

    modalImg.attr("src", largeImageUrl);
    currentIndex = imageUrls.indexOf(largeImageUrl);

    if (currentIndex === -1) {
      console.error("Image URL not found in array!");
    }

    preloadAdjacentImages(currentIndex);
    modal.fadeIn(300);
  });

  $(".close").on("click", function () {
    modal.fadeOut(300);
  });

  $(window).on("click", function (event) {
    if ($(event.target).is(modal)) {
      modal.fadeOut(300);
    }
  });

  function showImage(index) {
    currentIndex = (index + imageUrls.length) % imageUrls.length;
    const largeImageUrl = imageUrls[currentIndex];
    modalImg.attr("src", largeImageUrl);
    preloadAdjacentImages(currentIndex);
  }

  $("#downloadButton").on("click", function (event) {
    event.preventDefault();
    const thumbnailUrl = $("#modalImage").attr("src");
    const path = thumbnailUrl.split("/");
    const fullSize = path.filter((item) => item !== "/thumbnails");
    const keyElements = fullSize.slice(-2);
    const fullKey = keyElements.join("/");
    const downloadUrl = `/api/download?key=${encodeURIComponent(fullKey)}`;
    window.location.href = downloadUrl;
  });

  $("#next").on("click", function () {
    showImage(currentIndex + 1);
  });

  $("#prev").on("click", function () {
    showImage(currentIndex - 1);
  });

  $(document).on("keydown", function (event) {
    if (modal.is(":visible")) {
      if (event.key === "ArrowRight") {
        showImage(currentIndex + 1);
      } else if (event.key === "ArrowLeft") {
        showImage(currentIndex - 1);
      } else if (event.key === "Escape") {
        modal.fadeOut(300);
      }
    }
  });

  function preloadImage(url) {
    const img = new Image();
    img.src = url;
    /* console.log(`Preloading image: ${url}`); */
  }

  function preloadAdjacentImages(index) {
    const prevIndex = (index - 1 + imageUrls.length) % imageUrls.length;
    const nextIndex = (index + 1) % imageUrls.length;

    preloadImage(imageUrls[prevIndex]);
    preloadImage(imageUrls[nextIndex]);
  }

  function triggerImageDownload(url, fileName) {
    fetch(url)
      .then((response) => {
        if (!response.ok)
          throw new Error(`HTTP error! status: ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        const urlBlob = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = urlBlob;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(urlBlob);
      })
      .catch((error) => console.error("Download failed:", error));
  }
});
