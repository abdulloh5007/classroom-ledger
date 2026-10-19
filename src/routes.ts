import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idSchema, monthSchema, paymentPageQuery } from './contracts.js';
import type { LedgerService } from './services/ledger.js';

const paramsSchema = z.object({ id: idSchema }).strict();
const emptyQuery = z.object({}).strict();
export function registerRoutes(app: FastifyInstance, service: LedgerService): void {
  app.get('/groups', async (request) => {
    emptyQuery.parse(request.query);
    return service.groups();
  });
  app.post('/groups', async (request, reply) => {
    emptyQuery.parse(request.query);
    return reply.code(201).send(service.createGroup(request.body));
  });
  app.patch('/groups/:id', async (request) => {
    emptyQuery.parse(request.query);
    return service.updateGroup(paramsSchema.parse(request.params).id, request.body);
  });
  app.delete('/groups/:id', async (request, reply) => {
    emptyQuery.parse(request.query);
    service.deleteGroup(paramsSchema.parse(request.params).id);
    return reply.code(204).send();
  });
  app.get('/courses', async (request) => {
    emptyQuery.parse(request.query);
    return service.courses();
  });
  app.post('/courses', async (request, reply) => {
    emptyQuery.parse(request.query);
    return reply.code(201).send(service.createCourse(request.body));
  });
  app.patch('/courses/:id', async (request) => {
    emptyQuery.parse(request.query);
    return service.updateCourse(paramsSchema.parse(request.params).id, request.body);
  });
  app.delete('/courses/:id', async (request, reply) => {
    emptyQuery.parse(request.query);
    service.deleteCourse(paramsSchema.parse(request.params).id);
    return reply.code(204).send();
  });
  app.get('/students', async (request) => {
    const { groupId } = z.object({ groupId: idSchema.optional() }).strict().parse(request.query);
    return service.students(groupId);
  });
  app.post('/students', async (request, reply) => {
    emptyQuery.parse(request.query);
    return reply.code(201).send(service.createStudent(request.body));
  });
  app.patch('/students/:id', async (request) => {
    emptyQuery.parse(request.query);
    return service.updateStudent(paramsSchema.parse(request.params).id, request.body);
  });
  app.delete('/students/:id', async (request, reply) => {
    emptyQuery.parse(request.query);
    service.deleteStudent(paramsSchema.parse(request.params).id);
    return reply.code(204).send();
  });
  app.get('/students/:id/balance', async (request) => {
    const { month } = z.object({ month: monthSchema.optional() }).strict().parse(request.query);
    return service.balance(paramsSchema.parse(request.params).id, month);
  });
  app.get('/students/:id/payments', async (request) => {
    const query = paymentPageQuery.parse(request.query);
    const id = paramsSchema.parse(request.params).id;
    return query.limit === undefined ? service.payments(id) : service.paymentPage(id, query);
  });
  app.post('/students/:id/payments', async (request, reply) => {
    emptyQuery.parse(request.query);
    return reply
      .code(201)
      .send(service.addPayment(paramsSchema.parse(request.params).id, request.body));
  });
  app.get('/balances', async (request) => {
    const { month, groupId } = z
      .object({ month: monthSchema.optional(), groupId: idSchema.optional() })
      .strict()
      .parse(request.query);
    return service.monthlyBalances(month, groupId);
  });
  app.get('/debtors', async (request) => {
    const { month, groupId } = z
      .object({ month: monthSchema.optional(), groupId: idSchema.optional() })
      .strict()
      .parse(request.query);
    return service.debtors(month, groupId);
  });
}
