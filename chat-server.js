var http = require("http"),
    socketio = require("socket.io"),
    fs = require("fs");

var app = http.createServer(function(req, resp){
    fs.readFile("client.html", function(err, data){
        if(err) return resp.writeHead(500);
        resp.writeHead(200);
        resp.end(data);
    });
});
app.listen(3456);

var loggedusers = {};
var publicrooms = [];
var privaterooms = {};
var usersinroom = {};
var disabledSockets = {};
var directRooms = {};
var bannedusers = {};

var io = socketio.listen(app);

function findSocket(user){
    for(var s in io.sockets.sockets){
        if(io.sockets.sockets[s].username == user){
            return io.sockets.sockets[s];
        }
    }
    return null;
}

function sendDirectMessage(directmessage, username, touser, msg){
    var privateRoom = directRooms[username +"_to_"+touser];
    if(privateRoom == null || privateRoom == ""){
        privateRoom = username+"_to_"+touser;
        directRooms[username+"_to_"+touser] = privateRoom;
        directRooms[touser+"_to_"+username] = privateRoom;
        var fromSocket = findSocket(username);
        var toSocket = findSocket(touser);
        if(fromSocket != null && toSocket != null){
            fromSocket.join(privateRoom);
            toSocket.join(privateRoom);    
        }
    }
    io.sockets.in(privateRoom).emit("directmessage", username, touser, msg);
    console.log("directmessage to room "+privateRoom+": "+msg);
}

io.sockets.on("connection", function(socket){
    socket.on('userlogin', function(username){
        loggedusers[username] = username;
        socket.username = username;
        console.log("loggeduser: " +username);
        io.sockets.emit("publicroomlist", {message:publicrooms});
        io.sockets.emit("privateroomlist", {message:privaterooms});
    });
    
    socket.on('createroom', function(username, room, roompass){
        console.log("createroom: " +room+ " by " +username+ " and " +roompass+" end");
        if(roompass == ""){
            if(publicrooms.indexOf(room) == -1){
                publicrooms.push(room);
                io.sockets.emit("publicroomlist", {message:publicrooms});
            }
            else{
                io.sockets.emit("errormessage", username, "Name Already Taken!");
            }
        }
        else{
            privaterooms[room] = roompass;
            io.sockets.emit("privateroomlist", {message:privaterooms});
        }
        var userlist = [];
        usersinroom[room] = userlist;
        console.log("usersinroom: " + usersinroom[room]);
    });
    
    socket.on('joinpublicroom', function(username, room){
        console.log("joinpublicroom: "+socket.username+ " in " +room);
        console.log("usersinroom: " + usersinroom[room]);
        var userstoban = bannedusers[room];
        if(userstoban != null && userstoban.indexOf(socket.username) != -1){
            io.sockets.emit("errormessage", username, "You are banned from joining this room. Please select another room.");
            return;
        }
        if(usersinroom[room].indexOf(socket.username) == -1 && usersinroom[room].indexOf(socket.username+"(disabled)") == -1){
            usersinroom[room].push(username);
        }
        if(socket.room != null && socket.room != ""){
            var userindex = usersinroom[socket.room].indexOf(socket.username);
            var disabledindex = usersinroom[socket.room].indexOf(socket.username+"(disabled)");
            if(disabledindex == -1 && userindex != -1){
                usersinroom[socket.room].splice(userindex, 1);
                io.sockets.in(socket.room).emit("usersinroom", {message:usersinroom[socket.room]});
            }
            console.log(socket.room + " " + usersinroom[socket.room]);
            socket.leave(socket.room);
        }
        socket.room = room;
        socket.join(room);
        io.sockets.in(socket.room).emit("usersinroom", {message:usersinroom[socket.room]});
    });
    
    socket.on('deletepublicroom', function(room){
        console.log("deleting room: "+room);
        io.sockets.in(room).emit("errormessagetoroom", "Chat room "+room+" has been closed. Please join another room.");
        var userslist = usersinroom[room];
        for(var user in userslist){
            var s = findSocket(user);
            if(s != null){
                s.leave(room);
            }
        }
        var index = publicrooms.indexOf(room);
        if(index != -1){
            publicrooms.splice(index, 1);
        }
        console.log(publicrooms);
        io.sockets.emit("publicroomlist", {message:publicrooms});
    });
    
    socket.on('joinprivateroom', function(username, room, password){
        console.log("joinprivateroom: "+username+ " in " +room);
        console.log("usersinroom: " + usersinroom[room]);
        var userstoban = bannedusers[room];
        if(userstoban != null && userstoban.indexOf(socket.username) != -1){
            io.sockets.emit("errormessage", username, "You are banned from joining this room. Please select another room.");
            return;
        }
        if(privaterooms[room] == password){
            if(usersinroom[room].indexOf(socket.username) == -1 && usersinroom[room].indexOf(socket.username+"(disabled)") == -1){
            usersinroom[room].push(username);   
            }
            if(socket.room != null && socket.room != ""){
                var userindex = usersinroom[socket.room].indexOf(socket.username);
                var disabledindex = usersinroom[socket.room].indexOf(socket.username+"(disabled)");
                if(disabledindex == -1 && userindex != -1){
                    usersinroom[socket.room].splice(userindex, 1);
                    io.sockets.in(socket.room).emit("usersinroom", {message:usersinroom[socket.room]});
                }
                socket.leave(socket.room);
            }
            socket.room = room;
            socket.join(room);
            io.sockets.in(socket.room).emit("enterroomsuccess",username, room);
            io.sockets.in(socket.room).emit("usersinroom", {message:usersinroom[room]}); 
        }
        else{
            io.sockets.emit("errormessage", username, "Password Incorrect!");
        }
    });
    
    socket.on('deleteprivateroom', function(room){
        console.log("deleting room: "+room);
        io.sockets.in(room).emit("errormessagetoroom", "Chat room "+room+" has been closed. Please join another room.");
        var userslist = usersinroom[room];
        for(var user in userslist){
            var s = findSocket(user);
            if(s != null){
                s.leave(room);
            }
        }
        delete privaterooms[room];
        console.log(privaterooms);
        io.sockets.emit("privateroomlist", {message:privaterooms});
    });
    
    socket.on('removeusers', function(usernames, room, banuser){
        var userslist = usersinroom[room];
        for(var i = 0; i < usernames.length; ++i){
            if(banuser.toUpperCase() == "YES"){
                io.sockets.in(room).emit("banmessagetoroom", usernames[i], usernames[i]+" has been banned from the room!");
                var userstoban = [];
                userstoban.push(usernames[i]);
                bannedusers[room] = userstoban;
            }
            var index = userslist.indexOf(usernames[i]);
            userslist.splice(index, 1);
            io.sockets.in(socket.room).emit("usersinroom", {message:usersinroom[room]});
            var userSocket = findSocket(usernames[i]);
            if(userSocket != null){
                userSocket.leave(room);
            }
        }
    });
    
    socket.on('disableusers', function(usernames, room){
        var userslist = usersinroom[room];
        for(var i = 0; i < usernames.length; ++i){
            var index = userslist.indexOf(usernames[i]);
            userslist[index] += "(disabled)";
            io.sockets.in(socket.room).emit("usersinroom", {message:usersinroom[room]});
            var userSocket = findSocket(usernames[i]);
            if(userSocket != null){
                userSocket.leave(room);
                disabledSockets[usernames[i]] = userSocket;
            }
        }
    });
    
    socket.on('enableusers', function(usernames, room){
        var userslist = usersinroom[room];
        for(var i = 0; i < usernames.length; ++i){
            var index = userslist.indexOf(usernames[i]);
            var pos = userslist[index].indexOf("(disabled)");
            console.log(userslist[index] + " " + pos);
            console.log(userslist[index].substring(0,pos));
            userslist[index] = userslist[index].substring(0, pos);
            var userSocket = disabledSockets[userslist[index]];
            if(userSocket != null){
                userSocket.join(room);
                delete disabledSockets[userslist[index]];
            }
        }
        io.sockets.in(socket.room).emit("usersinroom", {message:usersinroom[room]});
    });
    
    socket.on('sendmsg', function(username, msg, touser, roomname){
        console.log("message from "+username+" to "+touser+" in room " +roomname+": "+msg);
        if(bannedusers[username] != null){
            return;
        }
        if(touser == "" && roomname != "" && bannedusers[username] == null){
            io.sockets.in(socket.room).emit("displaymsg", username, msg);    
        }
        else if(roomname != ""){
            sendDirectMessage("directmessage", username, touser, msg);
        }
    });
    
    socket.on('userlogout', function(){
        delete loggedusers[socket.username];
        console.log("room " + socket.room);
        if(socket.room != null && socket.room != ""){
            var userslist = usersinroom[socket.room];
            var index = userslist.indexOf(socket.username);
            userslist.splice(index, 1);
            io.sockets.in(socket.room).emit("usersinroom", {message:usersinroom[socket.room]});
            socket.leave(socket.room);
        }
    });
});
