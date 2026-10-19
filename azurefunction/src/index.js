const { app } = require('@azure/functions');

app.setup({
    enableHttpStream: true,
});

// PENTING: Daftarkan file fungsi agar dieksekusi oleh Host Azure Functions
require('./functions/jembatan-iot');