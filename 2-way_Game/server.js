var express = require('express');
var app = express();
var http = require('http').createServer(app);
var port = process.env.PORT || 1337;
var io = require('socket.io')(http);
var fs = require('fs');
var path = require('path');

var plys = [];
var messages = [];
var categories = [];
var categoryColors = [];
var questions = [];
var curquestion = {};
var game = {};
var sourceFileLine = 0;
var linebreak = '\r\n';
var settingsFile = 'settings.txt';

app.use(express.static(__dirname));

init();

app.get('/', function(req, res) {
	res.sendFile(__dirname + '/index.html');
});

app.get('/add', function(req, res) {
	res.sendFile(__dirname + '/add.html');
});

http.listen(port, function() {
	console.log('listening on *:' + port);
});

//--------------------------------------------------------------------------------------------
//------------------------------ EVENTS --------------------------------------
//--------------------------------------------------------------------------------------------

//new user connects
io.on('connection', function(socket) {
	//socket.emit : emit to just one socket, io.sockets.emit : emit to all sockets
	//write message to "DOS window"
	console.log('a user connected.');
	
	//initialize connected user
	socket.emit('initply', null);

	//receive (listen) 'disconnect'
	socket.on('disconnect', function() {
		console.log('user disconnected');
	});

	//receive (listen) 'join'
	socket.on('join', function(obj) {
		if (!obj.nickname)
			return;
		addNewPly(obj.nickname, obj.pid);
		io.emit('piedisplay', plys);
		emitQuestionDisplay();
		var newmsg = obj.nickname + ' has joined';
		console.log(newmsg + ' ' + obj.pid);
		storeMessage({name: "sysadmin", msg: newmsg});
		io.emit('categorydisplay', { cats: categories, colors: categoryColors });
		io.emit('chatmessage', messages);
	});

	//receive (listen) 'getInfo'
	socket.on('getInfo', function(plyId) {
		console.log('info request ' + plyId);
		var iply = getPlayer(plyId);
		//emit to caller only
		socket.emit('infoRequestResults', iply);
	});

	//receive (listen) 'redisplay'
	socket.on('redisplay', function() {
		//emit to caller only
		socket.emit('piedisplay', plys);
		socket.emit('categorydisplay', { cats: categories, colors: categoryColors });
		socket.emit('chatmessage', messages);
		emitQuestionDisplay();
	});
	
	//receive (listen) 'chatmessage'
	socket.on('chatmessage', function(obj) {
		console.log('message: ' + obj.name + " : " + obj.msg);
		//when client sends a message, call storeMessage
		storeMessage(obj);
		//rebroadcast message to all users
		io.emit('chatmessage', messages);
		//io.emit('chatmessage', { name: obj.name, msg: obj.msg });
	});

	//receive (listen) 'startGame'
	socket.on('startGame', function() {
		console.log('game started...');
		game.started = true;
		emitQuestionDisplay();
	});
	
	//receive (listen) 'answerSubmit'
	socket.on('answerSubmit', function(answr) {
		console.log('answer: ' + answr);
		console.log('curquestion.correct: ' + curquestion.correct);
        var curPly = getCurrentPlayer();
        var curAnswrText = curquestion.answers[answr];
		var objAnswer = { 
							guesser: curPly.name,
							answerText: curAnswrText,
							question: curquestion.question,
							correct: curquestion.answers[curquestion.correct]
						}
		if (answr.toLowerCase() == curquestion.correct.toLowerCase()) {
			//correct answer
			addpie(curquestion.category);
			objAnswer.answer = 'correct';
			io.emit('answerresult', objAnswer);
		}
		else { //incorrect answer
			objAnswer.answer = 'incorrect';
			io.emit('answerresult', objAnswer);
		}
		nextTurn();
		io.emit('piedisplay', plys);
		if (questions.length > 0) {
			curquestion = getQuestion();
			emitQuestionDisplay();
		}
		else {
			gameover();
		}
	});
	
	//receive (listen) 'add question'
	socket.on('addquestion', function(question) {
		var data = fs.readFileSync(__dirname + '/genus.json', 'utf8');
		/*//copy backup gile
		try {
			var rand = Math.floor((Math.random() * 100000) + 1);
			fs.writeFileSync(__dirname + '/dataBackups/genus' + rand + '.json', data, 'utf8');
		}
		catch(err) {
			console.log('fail writing backup: ' + err);
		}*/
		var questions = JSON.parse(data);
		questions.push(question);
		var questionsJSON = JSON.stringify(questions);
		try {
			fs.writeFileSync(__dirname + '/genus.json', questionsJSON, 'utf8');
		}
		catch(err) {
			console.log('fail writing file: ' + err);
			socket.emit('addresponse',  { success: false });
		}
		socket.emit('addresponse',  { success: true });
	});
	
	//receive (listen) 'getsourcefiles'
	socket.on('getsourcefiles', function(empty) {
		console.log('request for source files.');
		var fileAry = [];
		fs.readdir(__dirname, function(err, files) {
			if (err) return console.log(err);
			//use "for" loop (instead of forEach) so we can continue
			for (i=0; i < files.length; i++) {
				if (files[i] === 'package.json')
					continue;
				if (path.extname(files[i]) === ".json")
					fileAry.push(files[i]);
			}
			socket.emit('sourcefilesresponse', { files: fileAry.join(',') });
		});
	});
	
	//receive (listen) 'setsourcefile'
	socket.on('setsourcefile', function(file) {
		console.log('source file: ' + file);
		//read settings file and change first line only
		fs.readFile(__dirname + '/' + settingsFile, 'utf8', function(err, data) {
			if (err) return console.log(err);
			var lines = data.toString().split(linebreak);
			lines[sourceFileLine] = file;
			//write settings file
			//fs.writeFileSync(__dirname + '/' + settingsFile, lines.join(linebreak), 'utf8');
			fs.writeFile(__dirname + '/' + settingsFile, lines.join(linebreak), 'utf8', function (err) {
				if (err) return console.log(err);
				init();
			});
		});
	});
});

//--------------------------------------------------------------------------------------------
//------------------------------ FUNCTIONS --------------------------------------
//--------------------------------------------------------------------------------------------

//must use Function Declaration
//cannot use function expression "var functionOne = function()" because those are defined at run-time and init() is called during parse-time
function init() {
	fs.readFile(__dirname + '/' + settingsFile, 'utf8', function(err, data) {
		if (err) return console.log(err);
		var lines = data.toString().split(linebreak);
		fs.readFile(__dirname + '/' + lines[sourceFileLine], 'utf8', function(err, data) {
			if (err) return console.log(err);
			var jsQuestions = JSON.parse(data);
			questions.length = 0;
			console.log(jsQuestions.length + ' questions found.');
			jsQuestions.forEach(function(quests) {
				questions.push(quests);
				addCategory(quests.category);
			});
			assignCategoryColors();
			curquestion = getQuestion();
			game.started = false;
			emitQuestionDisplay();
		});
	});
}

var storeMessage = function(obj) {
	//add messages last in, displayed first
	messages.unshift({name: obj.name, msg: obj.msg});
	//add message to end of array
	//messages.push({name: obj.name, msg: obj.msg});
	//if more than 10 messages, delete last one
	//if (messages.length > 10)
	//	messages.shift();
};

var addNewPly = function(nickname, playerid) {
	if (plys.length > 5)
		return;
	var newply = {
		name: nickname,
		id: playerid,
		pnum: (plys.length + 1),
		pie1: false, 
		pie2: false, 
		pie3: false, 
		pie4: false, 
		pie5: false, 
		pie6: false, 
		pie1color: categoryColors[0], 
		pie2color: categoryColors[1], 
		pie3color: categoryColors[2], 
		pie4color: categoryColors[3], 
		pie5color: categoryColors[4], 
		pie6color: categoryColors[5], 
		isTurn: (plys.length == 0 ? true : false)
	};
	plys.push(newply);
};

var addpie = function(category) {
    var iply = getCurrentPlayer();
	var idx = categories.indexOf(category) + 1;
	if (iply && idx)
		iply["pie" + idx] = true;
};

var nextTurn = function(p) {
	var nextP = 0;
	plys.forEach(function(iply) {
		if (iply.isTurn) {
			iply.isTurn = false;
			nextP = iply.pnum + 1;
		}
		if (iply.pnum == nextP) {
			iply.isTurn = true;
		}
	});
	if (nextP > plys.length)
		plys[0].isTurn = true;
};

var getQuestion = function() {
	var rand = (Math.floor((Math.random() * questions.length) + 1) - 1);
	var quest = questions.splice(rand, 1);
	console.log(questions.length + ' questions left.');
	return quest[0];
};

var emitQuestionDisplay = function() {
	if (game.started) {
		var ply = getCurrentPlayer();
		if (ply && typeof curquestion !== 'undefined') {
			curquestion.questfor = ( ply ? ply.name : '');
			io.emit('questiondisplay', curquestion);
		}
	}
	else {
		io.emit('questiondisplay', null);
	}
};

var getCurrentPlayer = function() {
	var thisPlyr = {};
	plys.forEach(function(iply) {
		if (iply.isTurn)
			thisPlyr = iply;
	});
	return thisPlyr;
};

var getPlayer = function(plyid) {
	var thisPlyr = {};
	plys.forEach(function(iply) {
		if (iply.id == plyid)
			thisPlyr = iply;
	});
	return thisPlyr;
};

var addCategory = function(cat) {
	var isNew = true;
	//use "for" loop (instead of forEach) so we can break out
	for (i=0; i < categories.length; i++) {
		if (categories[i].toLowerCase() == cat.toLowerCase())
			isNew = false;
	}
	if (isNew)
		categories.push(cat);
};

var assignCategoryColors = function() {
	categoryColors = ['#3391BB', '#C93768', '#F6DF3F', '#A97C35', '#4EB83A', '#D84B11', 'red', 'purple', 'gray', 'black'];
	categoryColors.splice(categories.length, categoryColors.length - categories.length);
};

var gameover = function() {
	var winPlyr = getMostPies();
	io.emit('gameover', { name: winPlyr.name, numPies: winPlyr.numPies });
};

var getMostPies = function() {
	//who has most pies?
	var winPlyr = {};
	var winPies = 0;
	plys.forEach(function(iply) {
		var numPies = 0;
		if (iply.pie1)
			numPies++;
		if (iply.pie2)
			numPies++;
		if (iply.pie3)
			numPies++;
		if (iply.pie4)
			numPies++;
		if (iply.pie5)
			numPies++;
		if (iply.pie6)
			numPies++;
		if (numPies > winPies) {
			winPlyr = iply;
			winPlyr.numPies = numPies;
		}
	});
	return winPlyr;
};




////to support broadcast rooms, let's listen for another message
//socket.on("joinroom", function (roomname) {
//    socket.join(roomname);
//    console.log('user joined room');
//});