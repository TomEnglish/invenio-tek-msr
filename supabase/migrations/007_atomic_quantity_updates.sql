-- Atomic quantity deduction to prevent race conditions on concurrent updates
-- Uses SELECT ... FOR UPDATE to lock the row during the transaction

CREATE OR REPLACE FUNCTION deduct_material_quantity(
  p_material_id UUID,
  p_quantity INT,
  p_depleted_status TEXT DEFAULT 'depleted'
)
RETURNS TABLE(new_quantity INT, new_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current INT;
  v_new_qty INT;
  v_new_status TEXT;
BEGIN
  -- Lock the row to prevent concurrent reads
  SELECT current_quantity INTO v_current
  FROM materials
  WHERE id = p_material_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Material not found';
  END IF;

  v_new_qty := v_current - p_quantity;

  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'Cannot deduct more than available quantity (available: %)', v_current;
  END IF;

  IF v_new_qty = 0 THEN
    v_new_status := p_depleted_status;
  ELSE
    v_new_status := 'in_yard';
  END IF;

  UPDATE materials
  SET current_quantity = v_new_qty,
      status = v_new_status
  WHERE id = p_material_id;

  RETURN QUERY SELECT v_new_qty, v_new_status;
END;
$$;
