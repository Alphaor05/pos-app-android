export const printerService = {
    async printReceipt(device: { address: string; name: string }, data: any): Promise<boolean> {
        console.log('PRINTER_SERVICE_WEB_LOADED: Bluetooth printing is not supported on the web platform.', { device, data });
        return false;
    }
};
