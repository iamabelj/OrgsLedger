// Temporary preview server — serves the SPA frontend directly on localhost
// Run with: node preview-server.js
const express = require('express');
const path = require('path');
const app = express();

const webDir = path.resolve(__dirname, 'web');
app.use(express.static(webDir));
app.get('*', (req, res) => res.sendFile(path.join(webDir, 'index.html')));

app.listen(3001, () => console.log('SPA preview at http://localhost:3001'));
