(() => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const normalizeExpiry = (value) => {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    if (/^\d{8}$/.test(text))
      return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
    return "";
  };
  const parseScan = (raw) => {
    if (window.WmsScanner) {
      const result = window.WmsScanner.parseScan(raw);
      return {
        ...result,
        lot: result.lot || (Object.keys(result.pairs).length ? "" : result.raw),
      };
    }
    const value = String(raw || "").trim();
    const pairs = Object.fromEntries(
      value
        .split(/[|;]/)
        .map((part) => part.split(/[:=]/).map((piece) => piece.trim()))
        .filter((pair) => pair.length === 2 && pair[0] && pair[1])
        .map(([key, val]) => [key.toUpperCase(), val]),
    );
    return {
      raw: value,
      sku: pairs.SKU || pairs.PRODUCTO || "",
      ean: pairs.EAN || pairs.BARCODE || pairs.CB || "",
      lot:
        pairs.LOT ||
        pairs.LOTE ||
        pairs.NUMERO_LOTE ||
        (Object.keys(pairs).length ? "" : value),
      expiry: normalizeExpiry(pairs.EXP || pairs.VENCE || pairs.VENCIMIENTO),
    };
  };
  const refreshRow = (row) => {
    const receiving = Number(row.querySelector(".received-qty").value) > 0;
    row.querySelector(".lot").required =
      receiving && row.dataset.controlLot === "1";
    row.querySelector(".location").required = receiving;
    row.querySelector(".admission").required = receiving;
    row.querySelector(".expiry").required =
      receiving && row.dataset.controlExpiry === "1";
    row.classList.toggle("receive-row-skipped", !receiving);
  };
  document.querySelectorAll(".admission").forEach((i) => (i.value = today));
  document.querySelectorAll(".expiry").forEach((i) => (i.min = today));
  document.querySelectorAll(".receive-row").forEach((row) => {
    refreshRow(row);
  });
  document.querySelector("#receiveForm").addEventListener("input", (event) => {
    const row = event.target.closest(".receive-row");
    if (row && event.target.classList.contains("received-qty")) refreshRow(row);
  });
  document.addEventListener("wms:scan", (event) => {
    const input = event.detail?.input;
    if (!input?.classList?.contains("lot")) return;
    const currentRow = input.closest(".receive-row");
    const scan = parseScan(event.detail.value);
    const row =
      [...document.querySelectorAll(".receive-row")].find(
        (candidate) =>
          (scan.sku && candidate.dataset.sku === scan.sku) ||
          (scan.ean && candidate.dataset.ean === scan.ean) ||
          candidate.dataset.sku === scan.raw ||
          candidate.dataset.ean === scan.raw,
      ) || currentRow;
    if (
      scan.lot &&
      scan.raw !== row.dataset.ean &&
      scan.raw !== row.dataset.sku
    )
      row.querySelector(".lot").value = scan.lot;
    else if (scan.raw === row.dataset.ean || scan.raw === row.dataset.sku)
      row.querySelector(".lot").value = "";
    if (Number(row.querySelector(".received-qty").value) === 0)
      row.querySelector(".received-qty").value =
        row.querySelector(".received-qty").max;
    row.querySelector(".admission").value ||= today;
    if (scan.expiry) row.querySelector(".expiry").value = scan.expiry;
    refreshRow(row);
    row.classList.add("scanned");
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  document.querySelector("#receiveForm").addEventListener("submit", () => {
    const items = [...document.querySelectorAll(".receive-row")].map((row) => ({
      detalle_id: Number(row.dataset.detail),
      cantidad_recibida: Number(row.querySelector(".received-qty").value),
      numero_lote: row.querySelector(".lot").value,
      ubicacion_id: Number(row.querySelector(".location").value),
      fecha_ingreso: row.querySelector(".admission").value,
      fecha_vencimiento: row.querySelector(".expiry").value,
    }));
    document.querySelector("#receiveItems").value = JSON.stringify(items);
  });
})();
