import assert from "node:assert/strict";
import test from "node:test";

import { buildUnderwritingDialogCloseHandlers } from
  "../../app/underwriting-detail";

test("underwriting dialog cancel requests one controlled close", () => {
  let closeCount = 0;
  let cancelPrevented = false;
  const onClose = () => {
    closeCount += 1;
  };

  buildUnderwritingDialogCloseHandlers({ open: true, onClose }).onCancel({
    preventDefault() {
      cancelPrevented = true;
    },
  });
  buildUnderwritingDialogCloseHandlers({ open: false, onClose }).onClose();

  assert.equal(cancelPrevented, true);
  assert.equal(closeCount, 1);
});
