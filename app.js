require('dotenv').config();
const watch = require('node-watch');

const mapDir = process.env.MAP_DIR;

console.log('watching for map changes in', mapDir);

watch(mapDir, { recursive: true, filter: /\.bsp$/ }, handleFile);

function handleFile(event, path) {
    if (event == 'update') {
        console.log(path, 'has been updated!');
        console.log('copy bsp to tmp');
        console.log('pack files');
        console.log('unique name');
        console.log('bz2 zip');
        console.log('upload to server');
    }
}
