import type { NestExpressApplication } from '@nestjs/platform-express';

// I added this shared by bootstrap and HTTP regression tests, to help check for cors.
export function configureHttp(app: NestExpressApplication) {
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'https://whazzonline.com',
      'https://www.whazzonline.com',
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    maxAge: 600,
  });
}
