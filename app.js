require('dotenv').config();
const watch = require('node-watch');

console.log('watching for map changes');

watch(process.env.MAP_DIR, { recursive: true, filter: /\.bsp$/ }, console.log);
