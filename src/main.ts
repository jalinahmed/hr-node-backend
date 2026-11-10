
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

import { AppModule } from './app.module.js';

const require = createRequire(import.meta.url);

type HelmetMiddleware = (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  next: (error?: unknown) => void,
) => void;

type HelmetFactory = () => HelmetMiddleware;

const port = Number(process.env.PORT || 4000);

function diagnoseError(error: unknown) {
  const err = error as {
    name?: string;
    message?: string;
    code?: string;
    cause?: { code?: string };
  };

  const message = err?.message || '';
  const code = err?.code || err?.cause?.code || '';

  if (
    message.includes('MONGODB_URI') ||
    message.includes('JWT_SECRET')
  ) {
    return {
      reason: 'MISSING_ENVIRONMENT_VARIABLE',
      variable: message.includes('MONGODB_URI')
        ? 'MONGODB_URI'
        : 'JWT_SECRET',
    };
  }

  if (
    message.includes('SSL') ||
    message.includes('TLS') ||
    code.includes('SSL') ||
    code.includes('TLS')
  ) {
    return {
      reason: 'MONGODB_TLS_CONNECTION_FAILED',
      variable: 'MONGODB_URI',
    };
  }

  if (
    message.includes('Authentication failed') ||
    code === '18'
  ) {
    return {
      reason: 'MONGODB_AUTHENTICATION_FAILED',
      variable: 'MONGODB_URI',
    };
  }

  if (
    message.includes('Mongo') ||
    message.includes('Server selection')
  ) {
    return {
      reason: 'MONGODB_CONNECTION_FAILED',
      variable: 'MONGODB_URI',
    };
  }

  return {
    reason: 'APPLICATION_STARTUP_FAILED',
    errorType: err?.name || 'UnknownError',
  };
}

function startDiagnosticServer(error: unknown) {
  const diagnosis = diagnoseError(error);

  console.error('HR_BACKEND_STARTUP_FAILED:', error);

  const server = createServer((_req, res) => {
    res.writeHead(503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });

    res.end(
      JSON.stringify({
        status: 'error',
        service: 'Web Crest HR Backend API',
        message: 'Backend startup failed',
        ...diagnosis,
        environment: process.env.VERCEL
          ? 'vercel'
          : 'local',
      }),
    );
  });

  server.listen(port);
}

async function bootstrap() {
  const requiredVariables = [
    'MONGODB_URI',
    'JWT_SECRET',
  ];

  const missingVariables = requiredVariables.filter(
    (name) => !process.env[name]?.trim(),
  );

  if (missingVariables.length > 0) {
    const diagnostic = {
      status: 'error',
      service: 'Web Crest HR Backend API',
      message: 'Required environment variables missing',
      reason: 'MISSING_ENVIRONMENT_VARIABLE',
      missingVariables,
    };

    createServer((_req, res) => {
      res.writeHead(503, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });

      res.end(JSON.stringify(diagnostic));
    }).listen(port);

    return;
  }

  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
  });

  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const helmet = require('helmet') as HelmetFactory;

  app.use(helmet());

  app.getHttpAdapter().get('/', (_req: unknown, res: any) => {
    res.status(200).json({
      status: 'ok',
      service: 'Web Crest HR Backend API',
      message: 'Backend running successfully',
      documentation: '/api/docs',
    });
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('HR Backend API')
    .setDescription(
      'HR Management REST API built with NestJS and MongoDB',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const swaggerDocument = SwaggerModule.createDocument(
    app,
    swaggerConfig,
  );

  SwaggerModule.setup(
    'api/docs',
    app,
    swaggerDocument,
  );

  await app.listen(
    Number(config.get('PORT') ?? port),
  );

  console.log('HR Backend started successfully');
}

await bootstrap().catch((error: unknown) => {
  startDiagnosticServer(error);
});
