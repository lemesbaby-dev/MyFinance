-- ?1 = início (inclusive), ?2 = fim (inclusive).
-- Despesas do período por categoria, separando pago de pendente.
SELECT COALESCE(c.id, 0)                 AS category_id,
       COALESCE(c.name, 'Sem categoria') AS category,
       SUM(CASE WHEN t.status = 'paid'    THEN t.amount_cents ELSE 0 END) AS paid_cents,
       SUM(CASE WHEN t.status = 'pending' THEN t.amount_cents ELSE 0 END) AS pending_cents
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
 WHERE t.kind = 'expense' AND t.date BETWEEN ?1 AND ?2
 GROUP BY c.id
 ORDER BY (paid_cents + pending_cents) DESC;
