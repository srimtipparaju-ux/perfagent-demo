-- Order management dashboard query — runs every page load
-- Reported as slow by frontend team (avg 45 seconds)

SELECT DISTINCT
    o.order_id,
    o.order_date,
    o.status,
    c.customer_name,
    c.email,
    c.phone,
    c.address,
    c.country,
    r.region_name,
    r.region_code,
    p.product_name,
    p.category,
    (SELECT COUNT(*) 
     FROM order_items i 
     WHERE i.order_id = o.order_id)           AS item_count,
    (SELECT SUM(i.unit_price * i.quantity) 
     FROM order_items i 
     WHERE i.order_id = o.order_id)           AS order_total,
    (SELECT MAX(e.event_date)
     FROM order_events e
     WHERE e.order_id = o.order_id)           AS last_event
FROM   orders o,
       customers c,
       regions r
JOIN   products p  ON p.product_id = o.product_id
WHERE  c.customer_id   = o.customer_id
AND    UPPER(c.status)  = 'ACTIVE'
AND    TRUNC(o.order_date) BETWEEN '2024-01-01' AND '2024-03-31'
AND    o.amount        > 0
ORDER BY o.order_date DESC;
