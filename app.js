require('dotenv').config();
const watch = require('node-watch');
const tmp = require('tmp');

const mapDir = process.env.MAP_DIR;

console.log('watching for map changes in', mapDir);

watch(mapDir, { recursive: true, filter: /\.bsp$/ }, handleFile);

function handleFile(event, path) {
    if (event == 'update') {
        console.log(path, 'has been updated!');
        console.log('copy bsp to tmp');
        console.log(makeTempFile());
        console.log('pack files');
        console.log('unique name');
        console.log('bz2 zip');
        console.log('upload to server');
    }
}

function makeTempFile() {
    var tmpFile = tmp.fileSync();
    console.log("File: ", tmpFile.name);
    console.log("Filedescriptor: ", tmpFile.fd);

    // If we don't need the file anymore we could manually call the removeCallback
    // But that is not necessary if we didn't pass the keep option because the library
    // will clean after itself.
    tmpFile.removeCallback();

    return tmpFile;
}

function copyFile(source, target, cb) {
    var callback = false;

    var readStream = fs.createReadStream(source);
    readStream.on("error", function(err) {
        done(err);
    });
    var writeStream = fs.createWriteStream(target);
    writeStream.on("error", function(err) {
        done(err);
    });
    writeStream.on("close", function(ex) {
        done();
    });
    readStream.pipe(writeStream);

    function done(err) {
        if (!callback) {
            cb(err);
            callback = true;
        }
    }
}



