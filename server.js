const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const { exec } = require('child_process');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const os = require('os-utils');
const multer = require('multer');

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static('public'));

app.use(session({
    secret: "tjhosting",
    resave: false,
    saveUninitialized: true
}));

const db = new Database('db.sqlite');

// USERS
db.prepare(`CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY,
 username TEXT,
 password TEXT,
 role TEXT DEFAULT 'user',
 active INTEGER DEFAULT 0
)`).run();

// GAMES
db.prepare(`CREATE TABLE IF NOT EXISTS games (
 id INTEGER PRIMARY KEY,
 name TEXT,
 image TEXT,
 docker TEXT,
 port INTEGER
)`).run();

// SERVERS
db.prepare(`CREATE TABLE IF NOT EXISTS servers (
 id TEXT,
 user_id INTEGER,
 name TEXT,
 game TEXT,
 port INTEGER,
 expires INTEGER
)`).run();

// SETUP
let setupDone = db.prepare("SELECT * FROM users LIMIT 1").get() ? true : false;

app.post('/api/setup', async (req,res)=>{
 if(setupDone) return res.send("Schon gemacht");

 const hash = await bcrypt.hash(req.body.password,10);

 db.prepare("INSERT INTO users (username,password,role,active)")
 .run(req.body.username,hash,"admin",1);

 setupDone = true;
 res.send("Setup OK");
});

app.get('/api/setup',(req,res)=>{
 res.json({setup: setupDone});
});

// REGISTER
app.post('/api/auth/register', async (req,res)=>{
 const hash = await bcrypt.hash(req.body.password,10);

 db.prepare("INSERT INTO users (username,password,active)")
 .run(req.body.username,hash,0);

 res.send("⏳ Wartet auf Freischaltung");
});

// LOGIN
app.post('/api/auth/login',(req,res)=>{
 const user = db.prepare("SELECT * FROM users WHERE username=?")
 .get(req.body.username);

 if(!user) return res.send("User falsch");
 if(!user.active) return res.send("Nicht freigeschaltet");

 bcrypt.compare(req.body.password,user.password).then(ok=>{
  if(!ok) return res.send("Passwort falsch");

  req.session.user=user;
  res.send("Login OK");
 });
});

// USER CHECK
app.get('/api/auth/me',(req,res)=>{
 res.json(req.session.user || null);
});

// LOGOUT
app.get('/api/auth/logout',(req,res)=>{
 req.session.destroy();
 res.send("Logout");
});

// ADMIN USERS
app.get('/api/admin/users',(req,res)=>{
 res.json(db.prepare("SELECT * FROM users").all());
});

app.post('/api/admin/approve',(req,res)=>{
 db.prepare("UPDATE users SET active=1 WHERE id=?").run(req.body.id);
 res.send("Freigeschaltet");
});

app.post('/api/admin/block',(req,res)=>{
 db.prepare("UPDATE users SET active=0 WHERE id=?").run(req.body.id);
 res.send("Gesperrt");
});

app.post('/api/admin/role',(req,res)=>{
 db.prepare("UPDATE users SET role=? WHERE id=?")
 .run(req.body.role,req.body.id);
 res.send("Rolle gesetzt");
});

// GAMES
app.post('/api/admin/game',(req,res)=>{
 db.prepare("INSERT INTO games (name,image,docker,port)")
 .run(req.body.name,req.body.image,req.body.docker,req.body.port);
 res.send("Game erstellt");
});

app.get('/api/games',(req,res)=>{
 res.json(db.prepare("SELECT * FROM games").all());
});

// SERVER
let portBase = 25565;

app.post('/api/server/create',(req,res)=>{
 if(!req.session.user) return res.send("Login nötig");

 const game = db.prepare("SELECT * FROM games WHERE id=?")
 .get(req.body.game);

 const port = portBase++;
 const id = uuidv4();
 const expires = Date.now() + (7*24*60*60*1000);

 exec(`docker run -d -p ${port}:${game.port} --name ${id} ${game.docker}`);

 db.prepare("INSERT INTO servers VALUES (?,?,?,?,?,?)")
 .run(id,req.session.user.id,req.body.name,game.name,port,expires);

 res.send("Server erstellt");
});

// SERVER LIST
app.get('/api/server/list',(req,res)=>{
 if(!req.session.user) return res.json([]);

 const now = Date.now();

 let servers = db.prepare("SELECT * FROM servers WHERE user_id=?")
 .all(req.session.user.id);

 servers.forEach(s=>{
  s.expired = s.expires < now;
 });

 res.json(servers);
});

// FILE MANAGER
app.get('/api/files/:id',(req,res)=>{
 const path = req.query.path || "/";
 exec(`docker exec ${req.params.id} ls -la ${path}`, (e,out)=>res.send(out));
});

app.get('/api/file',(req,res)=>{
 exec(`docker exec ${req.query.id} cat ${req.query.path}`, (e,out)=>res.send(out));
});

app.post('/api/file/save',(req,res)=>{
 exec(`docker exec ${req.body.id} sh -c "echo '${req.body.content}' > ${req.body.path}"`);
 res.send("Gespeichert");
});

// UPLOAD
app.post('/api/upload', upload.single('file'), (req,res)=>{
 exec(`docker cp ${req.file.path} ${req.body.id}:${req.body.path}`);
 res.send("Upload OK");
});

// LIVE CONSOLE
io.on('connection', (socket)=>{
 socket.on('console', (id)=>{
  const logs = exec(`docker logs -f ${id}`);

  logs.stdout.on('data', (data)=>{
    socket.emit('log', data.toString());
  });
 });
});

// STATS
app.get('/api/system/stats',(req,res)=>{
 os.cpuUsage(v=>{
  res.json({
   cpu:(v*100).toFixed(1),
   ram:((1-os.freememPercentage())*100).toFixed(1)
  });
 });
});

http.listen(3000,()=>console.log("🔥 TJ Hosting läuft"));
