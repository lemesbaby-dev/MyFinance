-- ?1 = data limite do saldo previsto (YYYY-MM-DD).
-- atual    = saldo inicial + tudo que já foi pago
-- previsto = atual + pendentes com vencimento <= ?1 (inclui atrasados)
SELECT a.id, a.name, a.type,
       a.initial_balance_cents
         + COALESCE(SUM(CASE WHEN m.status = 'paid' THEN m.delta_cents END), 0)
         AS current_cents,
       a.initial_balance_cents
         + COALESCE(SUM(CASE WHEN m.status = 'paid' OR m.date <= ?1 THEN m.delta_cents END), 0)
         AS projected_cents
  FROM accounts a
  LEFT JOIN v_movements m ON m.account_id = a.id
 WHERE a.archived = 0
 GROUP BY a.id
 ORDER BY a.name;
