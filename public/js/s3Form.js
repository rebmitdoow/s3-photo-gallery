$("#S3CredentialsForm").on("submit", function (event) {
  event.preventDefault();

  const s3_name = $("#s3_name").val();
  const s3_access_key_id = $("#s3_access_key_id").val();
  const s3_secret_access_key = $("#s3_secret_access_key").val();
  const s3_region = $("#s3_region").val();
  const s3_endpoint = $("#s3_endpoint").val();

  $.ajax({
    url: "/api/user/s3-credentials",
    method: "POST",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${localStorage.getItem("authToken")}`,
    },
    data: JSON.stringify({
      s3_name,
      s3_access_key_id,
      s3_secret_access_key,
      s3_region,
      s3_endpoint,
    }),
    success: function (data) {
      if (data.message) {
        alert("S3 credentials updated successfully.");
      } else {
        alert(`Error: ${data.error}`);
      }
    },
    error: function (xhr, status, error) {
      console.error("Error:", error);
    },
  });
});
