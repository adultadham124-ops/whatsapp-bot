import express from 'express';
import path from 'path';
import routes from './routes';
import { startScheduler } from './services/schedulerService';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', routes);

startScheduler();

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
