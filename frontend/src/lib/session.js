// Decisão de sessão: de quem é o token e a cópia local deste aparelho.
// Regra de ouro: o token só vai para o localStorage (financas.conn) DEPOIS de `ensureUser` passar, e é gravado
// junto do userId. Se a cópia local é de outra conta com alterações não enviadas, o token novo fica só em
// memória (`held`) até o usuário decidir; enquanto isso (ou se token e cópia divergem) nada é enviado.
import { api, loadConn, saveConn, clearSession } from './api.js';
import * as db from './db.js';

let blocked = false; // há uma decisão pendente (conta diferente com alterações não enviadas)
let held = null; // { token, user }: login recém-feito que ainda não pode ser persistido

export const isBlocked = () => blocked;

const persist = (token, user) => saveConn({ ...loadConn(), token, userId: user.id });

/** sync() só roda com a conta confirmada: não bloqueada e token do mesmo usuário da cópia local. */
export async function canSync() {
  if (blocked) return false;
  const { userId } = loadConn();
  const local = await db.getMeta('user');
  return !(userId && local && userId !== local);
}

/** Depois do login Google: 'ok' (token persistido) ou 'blocked' (cópia local de outra conta com pendências). */
export async function accept(token, user) {
  try {
    await db.ensureUser(user.id);
  } catch (e) {
    if (e.message !== 'PENDING_OTHER_USER') throw e;
    held = { token, user };
    blocked = true;
    clearSession(); // nenhum token (nem o antigo) fica à mão enquanto a decisão não é tomada
    return 'blocked';
  }
  held = null;
  blocked = false;
  persist(token, user);
  return 'ok';
}

/** Ao abrir o app com sessão salva: { state: 'ok', user } ou { state: 'blocked' }. Lança se não der para confirmar (offline sem userId). */
export async function resume() {
  const { token, userId } = loadConn();
  const local = await db.getMeta('user');
  if (userId && local && userId !== local) { blocked = true; return { state: 'blocked' }; } // token de um, dados de outro
  let user = userId ? await db.getMeta('userInfo') : null;
  if (user && user.id !== userId) user = null;
  if (!user) {
    // Sessão antiga (sem userId) ou sem informação local: só o servidor diz de quem é o token.
    user = await api.me();
    if (local && local !== user.id) { blocked = true; return { state: 'blocked' }; }
    persist(token, user);
  }
  blocked = false;
  return { state: 'ok', user };
}

/** "Descartar e continuar": apaga a cópia da outra conta e segue com a que está esperando (ou a do token salvo). */
export async function discardAndContinue() {
  const h = held ?? { token: loadConn().token, user: null };
  const user = h.user ?? (await api.me()); // se falhar, nada foi apagado
  await db.wipe();
  await db.ensureUser(user.id);
  persist(h.token, user);
  held = null;
  blocked = false;
  return user;
}

/** "Entrar com outra conta": esquece o login em espera. */
export function abandon() {
  held = null;
  blocked = false;
  clearSession();
}
