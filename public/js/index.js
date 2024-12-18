const baseUrl = "http://localhost:5500";
const albumList = [];
const emptyList = $(".albumList");
const uploadButton = $("#uploadBtn");

$(document).ready(function () {
  $.ajax({
    url: "/api/albums",
    method: "GET",
    success: function (response) {
      const albumData = response.albums || [];
      albumData.forEach(function (album) {
        const cleanName = album.replace("/", "");
        console.log(cleanName);
        albumList.push(
          `<div class="album-card"><a href='${baseUrl}/gallerie?folderPath=${cleanName}'>${cleanName}</a></div>`
        );
      });
      console.log(albumList);
      emptyList.append(albumList.join(""));
    },
    error: function (err) {
      console.error("Error fetching albums:", err);
    },
  });
});
