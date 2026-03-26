import { Printer, PrinterConstants } from 'react-native-esc-pos-printer';

export interface PrinterService {
    printReceipt(device: { address: string; name: string }, data: any): Promise<boolean>;
}

export const printerService = {
    async printReceipt(device: { address: string; name: string }, data: any): Promise<boolean> {
        try {
            const printerWidth = data.settings?.receiptSize?.includes('80mm') ? 42 : 32;
            const date = new Date(data.createdAt);
            const dateStr = date.toLocaleDateString();
            const timeStr = date.toLocaleTimeString();

            const printer = new Printer({
                target: `BT:${device.address}`,
                deviceName: device.name
            });

            console.log(`Printer: Connecting to ${device.name} at ${device.address}...`);
            await printer.connect();
            console.log('Printer: Connected.');

            // NEW: Initialize the printer instance if method exists
            if (typeof printer.init === 'function') {
                await printer.init();
            }

            // NEW: Clear any existing commands in the buffer
            await printer.clearCommandBuffer();

            const { ESC_POS_COMMANDS, formatRow4, formatRow2 } = require('@/lib/escPosUtils');
            
            // 1. RESET USING RAW COMMAND (More reliable than addText)
            await printer.addCommand(new Uint8Array([0x1B, 0x40]));
            
            await printer.addTextAlign(PrinterConstants.ALIGN_CENTER);
            if (data.settings?.header) {
                await printer.addText(data.settings.header + '\n');
            } else {
                await printer.addText('CRUNCHNUM\n');
            }

            await printer.addFeedLine(1);
            await printer.addText(`${dateStr}, ${timeStr}\n`);
            if (data.paymentMethod) {
                await printer.addText(`Payment: ${data.paymentMethod}\n`);
            }
            await printer.addText(`Order: #${data.orderId.slice(0, 8).toUpperCase()}\n`);
            await printer.addFeedLine(1);
            
            await printer.addTextAlign(PrinterConstants.ALIGN_LEFT);

            await printer.addText(formatRow4('Qty', 'Item', 'Price', 'SubT', printerWidth) + '\n');
            await printer.addText('-'.repeat(printerWidth) + '\n');

            for (const item of data.items) {
                // Ensure name is safe for printing
                const safeName = item.name.replace(/[^\x20-\x7E]/g, ''); 
                await printer.addText(formatRow4(
                    item.quantity.toString(),
                    safeName,
                    `$${item.price.toFixed(2)}`,
                    `$${(item.price * item.quantity).toFixed(2)}`,
                    printerWidth
                ) + '\n');
            }

            await printer.addText('-'.repeat(printerWidth) + '\n');
            await printer.addFeedLine(1);
            
            await printer.addText(formatRow2('TOTAL', `$${data.total.toFixed(2)}`, printerWidth / 2) + '\n');

            await printer.addFeedLine(1);
            await printer.addTextAlign(PrinterConstants.ALIGN_CENTER);
            await printer.addText('-'.repeat(printerWidth) + '\n');
            if (data.settings?.footer) {
                await printer.addText(data.settings.footer + '\n');
            } else {
                await printer.addText('Thank you for shopping!\n');
            }

            await printer.addFeedLine(5); // Extra feed for manual tearing
            
            // 2. CONDITIONAL CUT - only for 80mm printers (which usually have cutters)
            const is80mm = data.settings?.receiptSize?.includes('80mm');
            if (is80mm) {
                console.log('Printer: Sending cut command (80mm only)...');
                await printer.addCut(PrinterConstants.CUT_FEED);
            } else {
                console.log('Printer: Skipping cut command (58mm/non-80mm)...');
            }

            console.log('Printer: Sending data to printer...');
            await printer.sendData();
            
            try {
                const status = await printer.getStatus();
                console.log('Printer Post-Print Status:', JSON.stringify(status));
            } catch (e) {
                console.log('Printer Status check failed (non-critical)');
            }

            // A small delay before disconnect helps some printers finish processing 
            await new Promise(resolve => setTimeout(resolve, 1500));
            await printer.disconnect();
            console.log('Printer: Print job complete.');

            return true;
        } catch (error) {
            console.warn('Native printer service failed', error);
            return false;
        }
    }
};
