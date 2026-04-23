const { spawn } = require('child_process');
const path = require('path');

const banner = `
  _   _                            
 | | | | ___ _ __ _ __ ___   ___  ___ 
 | |_| |/ _ \\ '__| '_ \` _ \\ / _ \\/ __|
 |  _  |  __/ |  | | | | | |  __/\\__ \\
 |_| |_|\\___|_|  |_| |_| |_|\\___||___/
                                       
 GATEWAY DASHBOARD ACTIVATED
======================================
`;

console.log('\x1b[36m%s\x1b[0m', banner);
console.log('Booting Hermes Gateway Platform...');

const serverPath = path.join(__dirname, 'web-server', 'server.js');

const server = spawn('node', [serverPath], { stdio: 'inherit' });

server.on('close', (code) => {
    console.log(`Hermes Gateway exited with code ${code}`);
});
