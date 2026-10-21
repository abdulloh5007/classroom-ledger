import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { idSchema, monthSchema, paymentPageQuery } from './contracts.js';
import type { LedgerService } from './services/ledger.js';

const paramsSchema = z.object({ id: idSchema }).strict();
const emptyQuery = z.object({}).strict();
export function registerRoutes(
  app: FastifyInstance,
  service: LedgerService,
  resolveService?: (request: FastifyRequest) => LedgerService,
): void {
  const ledger = (request: FastifyRequest) => resolveService?.(request) ?? service;
  app.get('/groups', async (request) => {
    emptyQuery.parse(request.query);
    return ledger(request).groups();
  });
  app.post('/groups', async (request, reply) => {
    emptyQuery.parse(request.query);
    return reply.code(201).send(ledger(request).createGroup(request.body));
  });
  app.patch('/groups/:id', async (request) => {
    emptyQuery.parse(request.query);
    return ledger(request).updateGroup(paramsSchema.parse(request.params).id, request.body);
  });
  app.delete('/groups/:id', async (request, reply) => {
    emptyQuery.parse(request.query);
    ledger(request).deleteGroup(paramsSchema.parse(request.params).id);
    return reply.code(204).send();
  });
  app.get('/courses', async (request) => {
    emptyQuery.parse(request.query);
    return ledger(request).courses();
  });
  app.post('/courses', async (request, reply) => {
    emptyQuery.parse(request.query);
    return reply.code(201).send(ledger(request).createCourse(request.body));
  });
  app.patch('/courses/:id', async (request) => {
    emptyQuery.parse(request.query);
    return ledger(request).updateCourse(paramsSchema.parse(request.params).id, request.body);
  });
  app.delete('/courses/:id', async (request, reply) => {
    emptyQuery.parse(request.query);
    ledger(request).deleteCourse(paramsSchema.parse(request.params).id);
    return reply.code(204).send();
  });
  app.get('/students', async (request) => {
    const { groupId } = z.object({ groupId: idSchema.optional() }).strict().parse(request.query);
    return ledger(request).students(groupId);
  });
  app.post('/students', async (request, reply) => {
    emptyQuery.parse(request.query);
    return reply.code(201).send(ledger(request).createStudent(request.body));
  });
  app.patch('/students/:id', async (request) => {
    emptyQuery.parse(request.query);
    return ledger(request).updateStudent(paramsSchema.parse(request.params).id, request.body);
  });
  app.delete('/students/:id', async (request, reply) => {
    emptyQuery.parse(request.query);
    ledger(request).deleteStudent(paramsSchema.parse(request.params).id);
    return reply.code(204).send();
  });
  app.get('/students/:id/balance', async (request) => {
    const { month } = z.object({ month: monthSchema.optional() }).strict().parse(request.query);
    return ledger(request).balance(paramsSchema.parse(request.params).id, month);
  });
  app.get('/students/:id/payments', async (request) => {
    const query = paymentPageQuery.parse(request.query);
    const id = paramsSchema.parse(request.params).id;
    return query.limit === undefined
      ? ledger(request).payments(id)
      : ledger(request).paymentPage(id, query);
  });
  app.post('/students/:id/payments', async (request, reply) => {
    emptyQuery.parse(request.query);
    return reply
      .code(201)
      .send(ledger(request).addPayment(paramsSchema.parse(request.params).id, request.body));
  });
  app.get('/balances', async (request) => {
    const { month, groupId } = z
      .object({ month: monthSchema.optional(), groupId: idSchema.optional() })
      .strict()
      .parse(request.query);
    return ledger(request).monthlyBalances(month, groupId);
  });
  app.get('/debtors', async (request) => {
    const { month, groupId } = z
      .object({ month: monthSchema.optional(), groupId: idSchema.optional() })
      .strict()
      .parse(request.query);
    return ledger(request).debtors(month, groupId);
  });
}
