export interface Event {
    id: string;
    title: string;
    dateTime: Date;
    location: string;
    description?: string;
    status: 'required' | 'optional';
}