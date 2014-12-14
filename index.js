var walkSync = require('walk-sync');
var Writer = require('broccoli-writer');
var UglifyJS = require('uglify-js');
var path = require('path');
var fs = require('fs');
var merge = require('lodash-node/modern/objects/merge');
var symlinkOrCopy = require('symlink-or-copy');
var mkdirp = require('mkdirp');
var srcURL = require('source-map-url');

module.exports = UglifyWriter;

UglifyWriter.prototype = Object.create(Writer.prototype);
UglifyWriter.prototype.constructor = UglifyWriter;

function UglifyWriter (inputTree, options) {
  if (!(this instanceof UglifyWriter)) {
    return new UglifyWriter(inputTree, options);
  }
  Writer.call(this, inputTree, options);
  this.options = merge({
    mangle: true,
    compress: true,
    sourceMapIncludeSources: true
  }, options);
  this.inputTree = inputTree;
}

UglifyWriter.prototype.write = function (readTree, outDir) {
  var self = this;
  return readTree(this.inputTree).then(function(inDir){
    walkSync(inDir).forEach(function(relativePath) {
      if (relativePath.slice(-1) === '/') {
        return;
      }
      var inFile = path.join(inDir, relativePath);
      var outFile = path.join(outDir, relativePath);
      mkdirp.sync(path.dirname(outFile));
      if (relativePath.slice(-3) === '.js') {
        self.processFile(inFile, outFile, relativePath);
      } else if (relativePath.slice(-4) === '.map') {
        // skip, because it will get handled when its corresponding JS does
      } else {
        symlinkOrCopy.sync(inFile, outFile);
      }
    });
    return outDir;
  });
};

UglifyWriter.prototype.processFile = function(inFile, outFile, relativePath) {
  var src = fs.readFileSync(inFile, 'utf-8');
  var mapName = outFile.replace(/\.js$/,'') + '.map';
  var origSourcesContent;

  var opts = {
    fromString: true,
    outSourceMap: path.basename(mapName),
    file: path.basename(inFile)
  };

  if (srcURL.existsIn(src)) {
    var url = srcURL.getFrom(src);
    opts.inSourceMap = path.join(path.dirname(inFile), url);
    origSourcesContent = JSON.parse(fs.readFileSync(opts.inSourceMap)).sourcesContent;
  }

  var result = UglifyJS.minify(src, merge(opts, this.options));
  var newSourceMap = JSON.parse(result.map);

  if (origSourcesContent) {
    // This is a workaround for https://github.com/mishoo/UglifyJS2/pull/566
    newSourceMap.sourcesContent = origSourcesContent;
  } else {
    newSourceMap.sources = [ relativePath ];
    newSourceMap.sourcesContent = [ src ];
  }

  newSourceMap.sources = newSourceMap.sources.map(function(path){
    // If out output file has the same name as one of our original
    // sources, they will shadow eachother in Dev Tools. So instead we
    // alter the reference to the upstream file.
    if (path === relativePath) {
      path = path.replace(/\.js$/, '-orig.js');
    }
    return path;
  });

  fs.writeFileSync(outFile, result.code);
  fs.writeFileSync(mapName, JSON.stringify(newSourceMap));
};