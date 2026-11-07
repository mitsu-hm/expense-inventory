import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { BRAND } from './shared/config';
const escapeHtml=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export default defineConfig({
 plugins:[react(),{name:'central-branding',transformIndexHtml(html){return html.replaceAll('__APP_NAME__',escapeHtml(BRAND.name)).replaceAll('__APP_TAGLINE__',escapeHtml(BRAND.tagline));}}],
 server:{port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:3001'},fs:{strict:true,deny:['**/.env*','**/*.{crt,pem}','**/.git/**','**/data/**','**/*.sqlite*','**/*.db*','**/server/**']}}
});
