/*

	bspsync - Automated pipeline for iterative public map testing.
	Copyright (C) 2017, aixxe. <aixxe@skyenet.org>

	Example usage:
		> bspsync.js --watch "d:\cstrike\maps" fy_aixxe.bsp

	This program is free software; you can redistribute it and/or modify
	it under the terms of the GNU General Public License as published by
	the Free Software Foundation; either version 2 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU General Public License for more details.

	You should have received a copy of the GNU General Public License
	along with bspsync. If not, see <http://www.gnu.org/licenses/>.

*/

require('dotenv').config()
const fs = require('fs');
const path = require('path');
const async = require('async');
const mkdirp = require('mkdirp');
const rcon = require('srcds-rcon');
const child_process = require('child_process');
const argv = require('minimist')(process.argv.slice(2));

const noisy_logging = false;

// Pull maps to watch from command line arguments.
const watch_files = {};

argv['_'].forEach(value => {
	if (!value.endsWith('.bsp'))
		value = value.append('.bsp');

	watch_files[value] = {last_active: 0, last_version: 0};
});

// Watch this folder for changes in the above .bsp files. Can be the same as the output folder.
const watch_folder = argv.watch;

// Use quickpack.py in ./bin to pack custom resources
const use_quickpack = argv['quickpack'] === true;

// The final versioned map file will be moved to this folder.
const output_folder = argv.output ? argv.output: argv.watch;

// Where to upload the final map file. (requires SFTP!)
const output_server = {
	address: process.env.REMOTE_ADDR,
	port: process.env.REMOTE_PORT,
	username: process.env.REMOTE_USER,
	password: '',
	private_key: {
		// PuTTY format key -- no passphrase support yet but might work with Pageant.
		filename: process.env.PRIVKEY
	},
	// Unfortunately, this IS required. (just run 'plink.exe <server host>' to get this)
	hostkey: process.env.HOSTKEY,
	paths: {
		// Absolute path to place the '.bsp.bz2' files in.
		fastdl: process.env.REMOTE_FASTDL_DIR,
		// Absolute path to place the '.bsp' files in.
		maps: process.env.REMOTE_MAP_DIR
	},
	// When enabled, automatically runs 'changelevel' after the map has been extracted.
	rcon: {
		enabled: true,
		address: process.env.REMOTE_ADDR,
		password: process.env.RCON_PASS
	}
};

// Ensure all the required external dependencies exist.
const bin_folder = path.resolve('./bin').concat(path.sep);

['bzip2.exe', 'plink.exe', 'pscp.exe'].forEach(basename => {
	let filename = bin_folder.concat(basename);

	if (!fs.existsSync(filename))
		return console.error(`fatal error: '${filename}' is missing.`);
});

if (use_quickpack) {
	if (!fs.existsSync(bin_folder.concat('QuickPack.py')))
		return console.error('fatal error: QuickPack.py is missing.');
}

// Determine the next version of the map. (increments largest existing version)
var getNextVersion = (basename, folder, callback) => {
	basename = basename.toLowerCase();

	fs.readdir(folder, (error, files) => {
		if (error)
			return callback(new Error('failed to read files from map directory.'));

		let ideal_version = 1;
		let version_regex = /_dev(\d+).bsp/g;

		for (var i = files.length - 1; i >= 0; i--) {
			if (!files[i].toLowerCase().startsWith(basename))
				continue;

			let map_version = version_regex.exec(files[i]);

			if (!map_version || map_version.length !== 2)
				continue;

			map_version = parseInt(map_version[1]);

			if (map_version >= ideal_version)
				ideal_version = map_version + 1;
		}

		return callback(false, ideal_version);
	});
};

// Main queue. Need to split this up into something more maintainable.
var bspsync = async.queue((task, callback) => {
	// Get the metadata for this map file.
	let watch_file = watch_files[task.file];

	// Resolve the absolute path on the filesystem to the input map file.
	let input_file = path.resolve(watch_folder + path.sep + task.file);
	let input_basename = path.parse(input_file).name;

	// find the best next version according to the output folder
	getNextVersion(input_basename, output_folder, (error, version) => {
		if (error)
			return callback(new Error('failed to get next map version.'));

		// Shorter versions of the final map name.
		let output_basename = input_basename + '_dev' + version;
		let output_filename = output_basename + '.bsp';

		// Full path to final map file on disk.
		let output_file = path.resolve(output_folder + path.sep + output_filename);

		console.log(`versioning map '${input_basename}' to '${output_basename}'..`);

		// Version the original map by moving it to the output folder.
		fs.rename(input_file, output_file, error => {
			if (error)
				return callback(new Error('failed to move map to output directory.'));

			if (use_quickpack) {
				console.log(`packing resources into '${output_filename}..'`);

				let quickpack = child_process.spawn('python', ['QuickPack.py', output_file], {cwd: bin_folder})
				
				if (noisy_logging) {
					quickpack.stdout.on('data', function(data) {
						console.log('stdout: ' + data);
					});

					quickpack.stderr.on('data', function(data) {
						console.log('stderr: ' + data);
					});
				}

				quickpack.on('close', code => {
					if (code !== 0)
						return callback(new Error('quickpack failed'));
				});
			}

			console.log(`compressing '${output_filename}' for fastdl..`);

			child_process.spawn(bin_folder.concat('bzip2.exe'), ['-z9', '-k', output_file], {cwd: bin_folder}).on('close', code => {
				if (code !== 0)
					return callback(new Error('failed to compress map.'));

				// Build the arguments for invoking pscp.
				let pscp_arguments = ['-batch', '-P', output_server.port, '-q', '-hostkey', output_server.hostkey];

				if (output_server.password.length)
					pscp_arguments.push('-pw', output_server.password);

				if (output_server.private_key.filename.length)
					pscp_arguments.push('-i', output_server.private_key.filename);

				pscp_arguments.push(output_file + '.bz2', `${output_server.username}@${output_server.address}:${output_server.paths.fastdl}`);

				// Upload the compressed map to the FastDL location with pscp.
				let pscp = child_process.spawn(bin_folder.concat('pscp.exe'), pscp_arguments, {cwd: bin_folder});

				console.log(`uploading '${output_filename}.bz2' to remote server..`);

				pscp.on('close', code => {
					if (code !== 0)
						return callback(new Error('failed to upload compressed map file to server.'));

					// Build the arguments for invoking plink.
					let plink_arguments = ['-ssh', '-batch', '-P', output_server.port, '-hostkey', output_server.hostkey];

					if (output_server.password.length)
						plink_arguments.push('-pw', output_server.password);

					if (output_server.private_key.filename.length)
						plink_arguments.push('-i', output_server.private_key.filename);

					plink_arguments.push(`${output_server.username}@${output_server.address}`);
					plink_arguments.push(`bunzip2 -k -c "${output_server.paths.fastdl}/${output_basename}.bsp.bz2" > "${output_server.paths.maps}/${output_basename}.bsp"`);

					// Run 'bunzip2' on the server to avoid uploading the map twice.
					let plink = child_process.spawn(bin_folder.concat('plink.exe'), plink_arguments, {cwd: bin_folder});

					console.log(`remotely extracting '${output_filename}.bz2' to game server..`);

					plink.on('close', code => {
						if (code !== 0)
							return callback(new Error('failed to extract map to game server directory.'));

						if (!output_server.rcon.enabled)
							return callback(false);

						let srcds_rcon = rcon({
							address: output_server.rcon.address,
							password: output_server.rcon.password
						});

						// Run 'changelevel' on the configured game server.
						console.log('changing level on remote game server..');

						srcds_rcon.connect().then(() => {
							return srcds_rcon.command(`changelevel ${output_basename}`).then(() => {
								return callback(false);
							});
						}).catch(error => {
							return callback(new Error('failed to changelevel on remote game server'));
						});
					});
				});
				return callback(false);
			});

			// Update metadata and write back.
			watch_file.last_version = version;
			watch_files[task.file] = watch_file;
		});
	});
}, 1);

fs.watch(watch_folder, (event, filename) => {
	// Only process 'change' watch events and ignore any maps outside of our specified list.
	if (event !== 'change' || Object.keys(watch_files).indexOf(filename) === -1)
		return false;

	// Ignore 'misfire' watch events by enforcing a small delay.
	let watch_file = watch_files[filename];

	if (watch_file.last_active !== 0)
		if (Date.now() - watch_file.last_active < 100)
			return false;

	// Update the 'last modified' time for this map.
	watch_file.last_active = Date.now();

	// Queue for uploading.
	let start_time = Date.now();

	return bspsync.push({file: filename}, error => {
		if (error)
			return console.error(error);

		console.log(`finished processing map '${filename}' in ${Date.now() - start_time} ms.`);
	});
});
