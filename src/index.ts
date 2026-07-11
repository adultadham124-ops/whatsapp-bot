import express from 'express';
import path from 'path';
import routes from './routes';
import { startScheduler } from './services/schedulerService';

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message);
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', routes);

app.get('/health', (_req, res) => res.send('OK'));

startScheduler();

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
