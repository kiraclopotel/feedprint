// FeelingWise — how the author on a record was arrived at.
//
// Absent is the ordinary case: the author on the record is the one the page
// showed beside the item, read where the adapter reads it.
//
// 'withheld' is the one case where the recorder refused an author it could
// see. On X the feed is virtualised: the page reuses one article slot for a
// new item while the recorder is reading it, so the header can belong to one
// account and the body to another. When the identity gate cannot show that
// the header and the body are the same item, the visible handle is thrown
// away and the record is written with no author, because signing one
// account's words under another's is the worst thing this product could do.
//
// Until 2026-09-17 the record did not say that had happened: about 179 rows a
// day in the owner's own export read as ordinary posts by an account called
// "unknown", with no status id and the page's own address, which a recipient
// cannot check against the platform and cannot tell from a failed read. The
// refusal is right; the silence about it was not.
//
// What this field does NOT do: it does not change the verdict. A withheld
// author stays whatever it was, a pass or a flag, so no count and no share in
// any export or dashboard moves because of it. Whether these encounters should
// instead be recorded as cancelled under the render gate's own
// 'cancelled-dom-recycled' verdict is the owner's call, and this field gives
// him the number it would move.
export type AuthorCapture = 'withheld';
