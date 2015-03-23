var debug = false;

var path = require("path");
var fs = require("fs");
var jsdom = require("jsdom").jsdom;
var prettyPrint = require("html").prettyPrint;
var serializeDocument = require("jsdom").serializeDocument;
var http = require("http");

// We want to load Readability and JSDOMParser, which aren't set up as commonjs libraries,
// and so we need to do some hocus-pocus with 'vm' to import them on a separate scope
// (identical) scope context.
var vm = require("vm");
var readabilityPath = path.join(__dirname, "..", "Readability.js");
var jsdomPath = path.join(__dirname, "..", "JSDOMParser.js");


var scopeContext = {};
// We generally expect dump() and console.{whatever} to work, so make these available
// in the scope we're using:
scopeContext.dump = console.log
scopeContext.console = console;

// Actually load files. NB: if either of the files has parse errors,
// node is dumb and shows you a syntax error *at this callsite* . Don't try to find
// a syntax error on this line, there isn't one. Go look in the file it's loading instead.
vm.runInNewContext(fs.readFileSync(jsdomPath), scopeContext, jsdomPath);
vm.runInNewContext(fs.readFileSync(readabilityPath), scopeContext, readabilityPath);

// Now make references to the globals in our scope so we can use them easily:
var Readability = scopeContext.Readability;
var JSDOMParser = scopeContext.JSDOMParser;


if (process.argv.length < 3) {
  console.error("Need at least a destination slug and potentially a URL (if the slug doesn't have source).");
  process.exit(0);
  return;
}

var slug = process.argv[2];
var url = process.argv[3]; // Could be undefined, we'll warn if it is if that is an issue.

var destRoot = path.join(__dirname, "test-pages", slug);

fs.mkdir(destRoot, function(err) {
  if (err) {
    var sourceFile = path.join(destRoot, "source.html");
    fs.exists(sourceFile, function(exists) {
      if (exists) {
        fs.readFile(sourceFile, {encoding: "utf-8"}, function(err, data) {
          if (err) {
            console.error("Source existed but couldn't be read?");
            process.exit(1);
            return;
          }
          onResponseReceived(data);
        });
      } else {
        fetchSource(url, onResponseReceived);
      }
    });
    return;
  }
  fetchSource(url, onResponseReceived);
});

function fetchSource(url, callbackFn) {
  if (!url) {
    console.error("You should pass a URL if the source doesn't exist yet!");
    process.exit(1);
    return;
  }
  var client = http;
  if (url.indexOf("https") == 0) {
    client = require("https");
  }
  client.get(url, function(response) {
    if (debug) {
      console.log("STATUS:", response.statusCode);
      console.log("HEADERS:", JSON.stringify(response.headers));
    }
    response.setEncoding("utf-8");
    var rv = "";
    response.on("data", function(chunk) {
      rv += chunk;
    });
    response.on("end", function() {
      if (debug) {
        console.log("End received");
      }
      // Sanitize:
      rv = prettyPrint(serializeDocument(jsdom(rv)));
      callbackFn(rv);
    });
  });
}

function onResponseReceived(source) {
  if (debug) {
    console.log("writing");
  }
  var sourcePath = path.join(destRoot, "source.html");
  fs.writeFile(sourcePath, source, function(err) {
    if (err) {
      console.error("Couldn't write data to source.html!");
      console.error(err);
      return;
    }
    if (debug) {
      console.log("Running readability stuff");
    }
    runReadability(source, path.join(destRoot, "expected.html"), path.join(destRoot, "expected-metadata.json"));
  });
}

function runReadability(source, destPath, metadataDestPath) {
  var doc = new JSDOMParser().parse(source);
  var uri = {
    spec: "http://fakehost/test/page.html",
    host: "fakehost",
    prePath: "http://fakehost",
    scheme: "http",
    pathBase: "http://fakehost/test"
  };
  try {
    var result = new Readability(uri, doc).parse();
  } catch (ex) {
    console.error(ex.stack);
  }
  if (!result) {
    console.error("No content generated by readability, not going to write expected.html!");
    return;
  }

  fs.writeFile(destPath, prettyPrint(result.content), function(err) {
    if (err) {
      console.error("Couldn't write data to expected.html!");
      console.error(err);
    }

    // Delete the result data we don't care about checking.
    delete result.uri;
    delete result.content;
    delete result.length;

    fs.writeFile(metadataDestPath, JSON.stringify(result, null, 2) + "\n", function(err) {
      if (err) {
        console.error("Couldn't write data to expected-metadata.json!");
        console.error(err);
      }

      process.exit(0);
    });
  });
}

