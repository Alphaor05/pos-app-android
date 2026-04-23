import { ReceiptPayload } from '@/lib/receiptBuilder';

export const printerService = {
    async printReceipt(device: { address: string; name: string }, data: ReceiptPayload): Promise<boolean> {
        console.log('PRINTER_SERVICE_WEB: Bluetooth printing not supported on web.', { device: device.name, orderId: data.orderId });
        return false;
    },
    async getPairedDevices(): Promise<{ name: string; address: string; id: string }[]> {
        return [];
    },
    async enableBluetooth(): Promise<boolean> {
        return false;
    },
    async openSettings(): Promise<boolean> {
        return false;
    }
};
