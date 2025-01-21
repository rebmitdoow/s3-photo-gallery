const baseUrl = "http://localhost:5500";
const emptyList = $(".albumList");

$(document).ready(function () {
  const token = localStorage.getItem("authToken");

  if (!token) {
    window.location.href = "/login";
    return;
  }

  $.ajax({
    url: `${baseUrl}/api/albums`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    success: function (response) {
      const albumData = response.albums || [];
      const albumContainer = $(".albumList");

      if (albumData.length === 0) {
        albumContainer.append("<p>No albums found.</p>");
      } else {
        albumData.forEach(function (album) {
          const albumCard = `<div class="album-card">
                      <a href='/gallerie?id=${encodeURIComponent(
                        album.album_name
                      )}' class="album-link">${album.album_name}</a>
                  </div>`;
          albumContainer.append(albumCard);
        });
      }
    },
    error: function (xhr) {
      console.log("Error response:", xhr);
      console.log("Response JSON:", xhr.responseJSON);

      if (xhr.status === 302) {
        const redirectUrl =
          /* xhr.responseJSON?.redirect ||  */ "/s3Form";
        console.log("Redirecting to:", redirectUrl);
        window.location.href = redirectUrl;
      } else if (xhr.status === 401 || xhr.status === 403) {
        alert("Session expired. Please log in again.");
        localStorage.removeItem("authToken");
        window.location.href = "/login";
      } else {
        $(".albumList").append(
          "<p>Failed to load albums. Please try again later.</p>"
        );
      }
    },
  });
});
