// In-ride chat between the rider and the assigned driver. Only the two parties
// to the ride may read or post, and only while the ride is live (from accepted
// through completed) — there is no counterpart to talk to before a driver
// accepts, and a cancelled ride's thread is closed.

import { badRequest, conflict, notFound } from '../lib/errors.js';
import { publicMessage } from './serialize.js';

const OPEN_STATES = new Set(['accepted', 'in_progress', 'completed']);
const MAX_LEN = 1000;

export function createMessagesService({ messages, rides, now = () => new Date() }) {
  function rideForParty(user, rideId) {
    const ride = rides.findById(rideId);
    if (!ride) throw notFound('Corrida não encontrada.', 'ride_not_found');
    if (ride.rider_id !== user.id && ride.driver_id !== user.id) {
      throw notFound('Corrida não encontrada.', 'ride_not_found');
    }
    return ride;
  }

  function list(user, rideId) {
    rideForParty(user, rideId);
    return messages.listByRide(rideId).map(publicMessage);
  }

  function send(user, rideId, body) {
    const ride = rideForParty(user, rideId);
    if (!ride.driver_id) throw conflict('Aguarde um motorista aceitar para conversar.', 'no_driver_yet');
    if (!OPEN_STATES.has(ride.status)) {
      throw conflict('O chat não está disponível para esta corrida.', 'chat_closed');
    }
    const text = String(body ?? '').trim();
    if (!text) throw badRequest('Mensagem vazia.', 'empty_message');
    if (text.length > MAX_LEN) throw badRequest('Mensagem muito longa.', 'message_too_long');

    const row = messages.create({ rideId, senderId: user.id, body: text.slice(0, MAX_LEN), createdAt: now().toISOString() });
    return publicMessage(row);
  }

  return { list, send };
}
