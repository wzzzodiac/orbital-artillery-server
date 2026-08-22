import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

import { CONFIG } from './config.js';
import { activateRoom, createRoom, findRoomBySocket, joinRoom, publicRoomState, removePlayer, roomStore, setGameMode, setPlayerReady, setPlayerTeam, startRoom } from './rooms.js';
import { isValidRoomCode, normalizePlayerName } from './validation.js';

const connectionWindows = new Map();
function clientIpFromRequest(req){const f=req.headers['x-forwarded-for'];if(typeof f==='string'&&f.length>0)return f.split(',')[0].trim();return req.socket.remoteAddress||'unknown';}
function allowConnectionAttempt(ip){const now=Date.now(),current=connectionWindows.get(ip);if(!current||now-current.startedAt>=60000){connectionWindows.set(ip,{startedAt:now,count:1});return true;}current.count+=1;return current.count<=CONFIG.connectionAttemptsPerMinute;}
setInterval(()=>{const cutoff=Date.now()-120000;for(const [ip,w] of connectionWindows)if(w.startedAt<cutoff)connectionWindows.delete(ip);},60000).unref();

let io;
const httpServer=createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify({ok:true,service:'orbital-artillery-server',rooms:roomStore.size,sockets:io?.engine?.clientsCount??0}));return;}res.writeHead(404,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'not_found'}));});
io=new SocketIOServer(httpServer,{cors:{origin:CONFIG.clientOrigin,methods:['GET','POST']},allowRequest:(req,cb)=>{const ip=clientIpFromRequest(req);if(io.engine.clientsCount>=CONFIG.maxConcurrentSockets)return cb('server_capacity_reached',false);if(!allowConnectionAttempt(ip))return cb('connection_rate_limited',false);cb(null,true);}});
function emitRoomState(room){io.to(room.code).emit('room_state',publicRoomState(room));}

io.on('connection',socket=>{
  console.info(`socket connected: ${socket.id}`);let packetWindowStartedAt=Date.now(),packetCount=0,lastActivityAt=Date.now(),roomActionsStartedAt=Date.now(),roomActionCount=0;
  socket.use((packet,next)=>{const now=Date.now();lastActivityAt=now;if(now-packetWindowStartedAt>=1000){packetWindowStartedAt=now;packetCount=0;}packetCount+=1;if(packetCount>CONFIG.packetsPerSecond){socket.disconnect(true);return;}next();});
  function allowRoomAction(){const now=Date.now();if(now-roomActionsStartedAt>=60000){roomActionsStartedAt=now;roomActionCount=0;}roomActionCount+=1;return roomActionCount<=20;}
  socket.on('create_room',(payload,reply=()=>{})=>{if(!allowRoomAction())return reply({ok:false,error:'room_action_rate_limited'});if(findRoomBySocket(socket.id))return reply({ok:false,error:'already_in_room'});const name=normalizePlayerName(payload?.name);if(!name)return reply({ok:false,error:'invalid_name'});const r=createRoom(socket.id,name);if(!r.ok)return reply(r);socket.join(r.room.code);reply({ok:true,room:publicRoomState(r.room),playerId:socket.id});emitRoomState(r.room);});
  socket.on('join_room',(payload,reply=()=>{})=>{if(!allowRoomAction())return reply({ok:false,error:'room_action_rate_limited'});if(findRoomBySocket(socket.id))return reply({ok:false,error:'already_in_room'});const name=normalizePlayerName(payload?.name),code=String(payload?.code??'').trim().toUpperCase();if(!name)return reply({ok:false,error:'invalid_name'});if(!isValidRoomCode(code))return reply({ok:false,error:'invalid_room_code'});const r=joinRoom(code,socket.id,name);if(!r.ok)return reply(r);socket.join(code);reply({ok:true,room:publicRoomState(r.room),playerId:socket.id});emitRoomState(r.room);});
  socket.on('set_mode',(payload,reply=()=>{})=>{if(!allowRoomAction())return reply({ok:false,error:'room_action_rate_limited'});const r=setGameMode(socket.id,String(payload?.mode??'').toLowerCase());if(!r.ok)return reply(r);reply({ok:true,room:publicRoomState(r.room)});emitRoomState(r.room);});
  socket.on('set_ready',(payload,reply=()=>{})=>{if(!allowRoomAction())return reply({ok:false,error:'room_action_rate_limited'});const r=setPlayerReady(socket.id,payload?.ready);if(!r.ok)return reply(r);reply({ok:true,room:publicRoomState(r.room)});emitRoomState(r.room);});
  socket.on('set_team',(payload,reply=()=>{})=>{if(!allowRoomAction())return reply({ok:false,error:'room_action_rate_limited'});const r=setPlayerTeam(socket.id,String(payload?.team??'').toUpperCase());if(!r.ok)return reply(r);reply({ok:true,room:publicRoomState(r.room)});emitRoomState(r.room);});
  socket.on('start_game',(_payload,reply=()=>{})=>{if(!allowRoomAction())return reply({ok:false,error:'room_action_rate_limited'});const r=startRoom(socket.id);if(!r.ok)return reply(r);reply({ok:true,room:publicRoomState(r.room)});emitRoomState(r.room);const code=r.room.code,delay=Math.max(0,r.room.match.startAt-Date.now());setTimeout(()=>{const active=activateRoom(code);if(active)emitRoomState(active);},delay).unref();});
  const idleTimer=setInterval(()=>{if(Date.now()-lastActivityAt>=CONFIG.idleSocketMinutes*60000)socket.disconnect(true);},60000);idleTimer.unref();
  socket.on('disconnect',reason=>{clearInterval(idleTimer);const removal=removePlayer(socket.id);if(removal?.room)emitRoomState(removal.room);console.info(`socket disconnected: ${socket.id} (${reason})`);});
});
httpServer.listen(CONFIG.port,'0.0.0.0',()=>console.info(`Orbital Artillery server listening on :${CONFIG.port}`));
