var express = require('express');
var path = require('path');
var app = express();

app.use('/assets', express.static(path.join(__dirname, '/assets')));

console.log("SAI");

app.get('/', function(req, res){

	res.status(200);
	console.log("SAI")
	res.setHeader("Content-Type", "text/html");
	res.sendFile(path.join(__dirname, '/index.html'));

});

server = app.listen(4000, function(){
	var host = server.address().address; //host will be "::" as no host is explicitly specified in app.listen
	var port = server.address().port;
	console.log("http server listening at http://%s:%s", host, port);
});