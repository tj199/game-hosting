#!/bin/bash

echo "🔥 TJ Hosting Installer..."

apt update && apt upgrade -y
apt install curl wget git nano ufw -y

ufw allow 22
ufw allow 3000
ufw allow 25565:26000/tcp
ufw allow 2456:25000/udp
ufw --force enable

curl -fsSL https://get.docker.com | bash
systemctl enable docker
systemctl start docker

curl -fsSL https://deb.nodesource.com/setup_20.x | bash
apt install -y nodejs
npm install -g pm2

cd /root
rm -rf hosting
git clone https://github.com/tj199/game-hosting.git hosting
cd hosting

npm install

pm2 start server.js
pm2 save

echo "✅ Fertig!"
echo "🌐 http://SERVER-IP:3000/setup.html"
