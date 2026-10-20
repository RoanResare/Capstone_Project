import {createServer} from '../../node_modules/vite/dist/node/index.js';
const server=await createServer({server:{host:'127.0.0.1',port:5181,watch:{ignored:['**/artifacts/**']}}});await server.listen();console.log('UI review server ready on 5181');
