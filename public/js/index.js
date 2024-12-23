const baseUrl = "http://localhost:5500";
const emptyList = $(".albumList");

$(document).ready(function () {
  // Check if authToken exists in localStorage
  const token = localStorage.getItem("authToken");

  if (!token) {
    // If no token, redirect to login page
    window.location.href = "/login";
    return;
  }

  // Make an API call to fetch albums with the token
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
        // Create album cards dynamically
        albumData.forEach(function (album) {
          const cleanName = album.replace("/", "");
          const albumCard = `<div class="album-card">
                      <a href='/gallerie?id=${encodeURIComponent(
                        cleanName
                      )}' class="album-link">${cleanName}</a>
                  </div>`;
          albumContainer.append(albumCard);
        });
      }
    },
    error: function (xhr) {
      if (xhr.status === 401 || xhr.status === 403) {
        // If unauthorized, clear the token and redirect to login
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
  