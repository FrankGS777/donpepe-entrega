// The selection only changes which existing document is displayed. It never
// authorizes a dispatch, changes device state or infers an order by proximity.
export function inspectionOrderId(snapshot, selection, previousOrderId = null) {
  if (!selection) return previousOrderId;
  const { type, id } = selection;
  let record;
  if (type === "truck") record = snapshot?.equipment?.trucks?.find(item => item.id === id);
  else if (type === "robot" || type === "equipment") record = snapshot?.equipment?.robots?.find(item => item.id === id);
  else if (type === "hu") record = (snapshot?.inventory?.hus || snapshot?.hus || []).find(item => item.id === id);
  else if (type === "mission") record = snapshot?.missions?.find(item => item.id === id);
  const mission = record?.missionId ? snapshot?.missions?.find(item => item.id === record.missionId) : null,
    orderId = record?.orderId || mission?.orderId;
  return orderId && snapshot?.orders?.some(order => order.id === orderId) ? orderId : previousOrderId;
}
