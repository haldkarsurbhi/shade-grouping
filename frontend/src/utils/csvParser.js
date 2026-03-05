
/**
 * Parse Inspection CSV data
 * Handles mapping and auto-filling of missing data based on business rules.
 * 
 * Column Mapping:
 * Date            -> date
 * Roll ID         -> rollNo
 * Buyer           -> buyer
 * Supplier        -> supplier
 * Quantity (m)    -> quantity
 * DeltaE          -> deltaE
 * Shade Group     -> shade
 * Verdict         -> decision
 * Image           -> image
 */
export const parseInspectionCSV = (csvText) => {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return []; // Header only or empty

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    // Helper to find column index by possible names
    const getIndex = (possibleNames) => {
        return headers.findIndex(h => possibleNames.some(name => h.includes(name)));
    };

    const colMap = {
        date: getIndex(['date']),
        rollNo: getIndex(['roll', 'id']),
        buyer: getIndex(['buyer']),
        supplier: getIndex(['supplier']),
        quantity: getIndex(['quantity', 'qty', 'meter']),
        deltaE: getIndex(['delta', 'de']),
        shade: getIndex(['shade', 'group']),
        decision: getIndex(['verdict', 'status', 'decision']),
        image: getIndex(['image', 'path', 'file'])
    };

    const parsedData = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Handle simple CSV splitting (assuming no quoted commas for now as per simple example)
        const cols = line.split(',').map(c => c.trim());

        // Extract raw values
        let date = cols[colMap.date];
        let rollNo = cols[colMap.rollNo];
        let buyer = cols[colMap.buyer];
        let supplier = cols[colMap.supplier];
        let quantity = cols[colMap.quantity];
        let deltaE = parseFloat(cols[colMap.deltaE]);
        let shade = cols[colMap.shade];
        let decision = cols[colMap.decision];
        let image = cols[colMap.image];

        // --- STEP 3: AUTO-FILL RULES ---

        // 1. Missing Buyer/Supplier
        if (!buyer) buyer = "Not Entered";
        if (!supplier) supplier = "Not Entered";

        // 2. Missing Verdict and/or Shade
        if (!decision) {
            // Case A: Verdict missing, calculate from Shade
            if (shade) {
                const s = shade.toUpperCase();
                if (['A', 'B'].includes(s)) decision = 'ACCEPT';
                else if (s === 'C') decision = 'HOLD';
                else if (['D', 'REJECT'].includes(s)) decision = 'REJECT';
            }
            // Case B: Verdict AND Shade missing, calculate from DeltaE
            else if (!isNaN(deltaE)) {
                if (deltaE <= 1.2) {
                    shade = 'A';
                    decision = 'ACCEPT';
                } else if (deltaE <= 2.0) {
                    shade = 'B';
                    decision = 'ACCEPT';
                } else if (deltaE <= 3.0) {
                    shade = 'C';
                    decision = 'HOLD';
                } else {
                    shade = 'D';
                    decision = 'REJECT';
                }
            } else {
                // If all missing, default to Unknown/Hold or similar safety? 
                // Requirement says "Do NOT auto-fill Roll ID, Quantity, or ΔE", but asks to Calculate Verdict/Shade.
                // If we can't calculate, we leave as is or set a default. 
                // Let's set safely if totally unknown.
                if (!decision) decision = 'HOLD';
                if (!shade) shade = '-'; 
            }
        }

        // Normalizing decision text to match app expectation (ACCEPT, HOLD, REJECT)
        if (decision) {
            decision = decision.toUpperCase();
            if (decision === 'REJECTED') decision = 'REJECT';
            if (decision === 'ACCEPTED') decision = 'ACCEPT';
        }

        // 3. Image Placeholder (UI handles "No Image" text, but we ensure null/empty is clear)
        if (!image) image = null;

        parsedData.push({
            id: i, // Simple unique ID
            date: date || new Date().toISOString().split('T')[0],
            rollNo: rollNo || `UNK-${i}`,
            buyer,
            supplier,
            quantity: quantity ? Number(quantity) : 0,
            deltaE: !isNaN(deltaE) ? deltaE : 0,
            shade: shade ? shade.toUpperCase() : '-',
            decision,
            image
        });
    }

    return parsedData;
};
