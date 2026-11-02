import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const portFlag=process.argv.indexOf('--port');
const port=Number(portFlag>=0?process.argv[portFlag+1]:process.env.PORT||5173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.csv':'text/csv'};
http.createServer(async(req,res)=>{try{let filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!filename.startsWith(root+path.sep)&&filename!==root)throw Error();if((await stat(filename)).isDirectory())filename=path.join(filename,'index.html');res.setHeader('Content-Type',types[path.extname(filename)]||'text/plain');res.setHeader('Cache-Control','no-cache');res.end(await readFile(filename));}catch{res.statusCode=404;res.end('Not found');}}).listen(port,'0.0.0.0',()=>console.log(`VR Lab ready on ${port}`));
