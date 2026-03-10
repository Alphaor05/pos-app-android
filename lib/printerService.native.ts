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

            await printer.connect();

            await printer.addTextAlign(PrinterConstants.ALIGN_CENTER);
            await printer.addTextSize({ width: 2, height: 2 });
            await printer.addText(data.settings?.businessName || 'MY BUSINESS');
            await printer.addText('\n');

            await printer.addTextSize({ width: 1, height: 1 });
            if (data.settings?.address) {
                await printer.addText(data.settings.address);
                await printer.addText('\n');
            }
            if (data.settings?.contactTel) {
                await printer.addText(`Tel: ${data.settings.contactTel}`);
                await printer.addText('\n');
            }

            await printer.addFeedLine(1);
            await printer.addText(`${dateStr} ${timeStr}\n`);
            await printer.addText(`SALE - #${data.orderId.slice(0, 8).toUpperCase()}\n`);
            // Use local dashedLine logic or pass it from context
            await printer.addText('-'.repeat(printerWidth) + '\n');

            await printer.addTextAlign(PrinterConstants.ALIGN_LEFT);
            // Row formatting should be passed or reimplemented here
            // For simplicity in this bridge, we assume the strings are already formatted
            // Or we can import the utils here too
            const { formatRow3, formatRow2 } = require('@/lib/escPosUtils');

            await printer.addText(formatRow3('Qty', 'Item', 'SubT', printerWidth) + '\n');
            await printer.addText('-'.repeat(printerWidth) + '\n');

            for (const item of data.items) {
                await printer.addText(formatRow3(
                    item.quantity.toString(),
                    item.name,
                    `$${(item.price * item.quantity).toFixed(2)}`,
                    printerWidth
                ) + '\n');
            }

            await printer.addText('-'.repeat(printerWidth) + '\n');
            await printer.addText(formatRow2('Subtotal', `$${data.subtotal.toFixed(2)}`, printerWidth) + '\n');

            if (data.discount > 0) {
                await printer.addText(formatRow2('Discount', `-$${data.discount.toFixed(2)}`, printerWidth) + '\n');
            }

            await printer.addFeedLine(1);
            await printer.addTextSize({ width: 2, height: 2 });
            await printer.addText(formatRow2('TOTAL', `$${data.total.toFixed(2)}`, printerWidth) + '\n');

            await printer.addTextSize({ width: 1, height: 1 });
            await printer.addFeedLine(1);
            await printer.addTextAlign(PrinterConstants.ALIGN_CENTER);
            await printer.addText(data.settings?.footerMessage || 'Thank you!\n');

            await printer.addFeedLine(3);
            await printer.addCut(PrinterConstants.CUT_FEED);

            await printer.sendData();
            await printer.disconnect();

            return true;
        } catch (error) {
            console.warn('Native printer service failed', error);
            return false;
        }
    }
};
