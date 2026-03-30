const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const { exec } = require('child_process');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const os = require('os-utils');

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.use(session({
    secret: "supersecret",
    resave: false,
    saveUninitialized: true
}));

const db = new Database('db.sqlite');

// DB
db.prepare(`CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY,
 username TEXT,
 password TEXT,
 max_servers INTEGER DEFAULT 2
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS servers (
 id TEXT,
 user_id INTEGER,
 game TEXT,
 port INTEGER
)`).run();

// Games
const GAMES = {
 minecraft: { image: "itzg/minecraft-server", port: 25565 },
 rust: { image: "didstopia/rust-server", port: 28015 },
 valheim: { image: "lloesche/valheim-server", port: 2456 }
};

let currentPort = 25565;
function getPort(){ return currentPort++; }

// Auth
function auth(req,res,next){
 if(!req.session.user) return res.send("Login nötig");
 next();
}

// Register
app.post('/api/auth/register', async (req,res)=>{
 if(req.body.password.length < 6) return res.send("Passwort zu kurz");
 const hash = await bcrypt.hash(req.body.password,10);
 db.prepare("INSERT INTO users (username,password) VALUES (?,?)")
 .run(req.body.username,hash);
 res.send("OK");
});

// Login
app.post('/api/auth/login',(req,res)=>{
 const user = db.prepare("SELECT * FROM users WHERE username=?")
 .get(req.body.username);

 if(!user) return res.send("User nicht gefunden");

 bcrypt.compare(req.body.password,user.password).then(ok=>{
  if(!ok) return res.send("Falsch");
  req.session.user=user;
  res.send("OK");
 });
});

// Create server
app.post('/api/server/create',auth,(req,res)=>{
 const user = req.session.user;

 const count = db.prepare("SELECT COUNT(*) as c FROM servers WHERE user_id=?")
 .get(user.id);

 if(count.c >= user.max_servers) return res.send("Limit erreicht");

 const game = GAMES[req.body.game];
 if(!game) return res.send("Game nicht gefunden");

 const port = getPort();
 const id = uuidv4();

 const cmd = `docker run -d -p ${port}:${game.port} --name ${id} ${game.image}`;
 exec(cmd);

 db.prepare("INSERT INTO servers VALUES (?,?,?,?)")
 .run(id,user.id,req.body.game,port);

 res.send("Server läuft auf Port "+port);
});

// List
app.get('/api/server/list',auth,(req,res)=>{
 const rows = db.prepare("SELECT * FROM servers WHERE user_id=?")
 .all(req.session.user.id);
 res.json(rows);
});

// Stop
app.post('/api/server/stop',(req,res)=>{
 exec(`docker stop ${req.body.id}`);
 res.send("OK");
});

// Delete
app.post('/api/server/delete',(req,res)=>{
 exec(`docker rm -f ${req.body.id}`);
 db.prepare("DELETE FROM servers WHERE id=?").run(req.body.id);
 res.send("OK");
});

// Stats
app.get('/api/system/stats',(req,res)=>{
 os.cpuUsage(v=>{
  res.json({
   cpu: (v*100).toFixed(1),
   ram: ((1-os.freememPercentage())*100).toFixed(1)
  });
 });
});

app.listen(3000,()=>console.log("Hosting läuft"));
