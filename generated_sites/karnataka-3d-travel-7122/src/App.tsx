import React, { useState } from 'react';
import { Compass, MapPin, Calendar, Send, Star } from 'lucide-react';

export default function App() {
  const [booking, setBooking] = useState({ name: '', destination: 'Hampi Heritage', date: '' });
  const [status, setStatus] = useState('');

  const destinations = [
    { id: 1, name: 'Hampi Heritage Ruins', price: '₹14,999', rating: '4.9' },
    { id: 2, name: 'Coorg Coffee Hills', price: '₹11,499', rating: '4.8' },
    { id: 3, name: 'Gokarna Beach Retreat', price: '₹9,999', rating: '4.7' },
  ];

  const handleBooking = (e) => {
    e.preventDefault();
    setStatus('✓ Booking Enquiry Submitted for ' + booking.destination + '!');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono">
      <header className="border-b border-cyan-900/50 bg-black/80 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-2 text-cyan-400">
          <Compass className="w-6 h-6 animate-spin" />
          <span className="font-bold tracking-widest text-lg">KARNATAKA 3D EXPLORER</span>
        </div>
        <nav className="space-x-4 text-xs text-gray-400">
          <a href="#destinations" className="hover:text-cyan-400">Destinations</a>
          <a href="#booking" className="hover:text-cyan-400">Book Tour</a>
        </nav>
      </header>

      <main className="p-8 max-w-5xl mx-auto space-y-12">
        <section className="text-center space-y-4">
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
            Discover One State. Many Worlds.
          </h1>
          <p className="text-sm text-gray-400 max-w-xl mx-auto">
            Interactive 3D tour packages, ancient heritage, coffee plantations & pristine coastlines of Karnataka.
          </p>
        </section>

        <section id="destinations" className="grid md:grid-cols-3 gap-6">
          {destinations.map(d => (
            <div key={d.id} className="border border-cyan-900/40 bg-black/50 p-5 rounded-xl hover:border-cyan-500 transition space-y-3">
              <div className="flex justify-between items-center text-cyan-400">
                <MapPin className="w-5 h-5" />
                <span className="text-xs flex items-center"><Star className="w-3 h-3 text-amber-400 mr-1"/> {d.rating}</span>
              </div>
              <h3 className="font-bold text-white text-base">{d.name}</h3>
              <p className="text-xs text-gray-400">Complete 3-day guided heritage & luxury experience.</p>
              <div className="flex justify-between items-center pt-2">
                <span className="text-cyan-300 font-bold">{d.price}</span>
                <button onClick={() => setBooking({ ...booking, destination: d.name })} className="px-3 py-1 bg-cyan-500/20 text-cyan-300 border border-cyan-500 rounded text-xs hover:bg-cyan-500/40">Select</button>
              </div>
            </div>
          ))}
        </section>

        <section id="booking" className="border border-cyan-900/50 bg-black/60 p-6 rounded-2xl max-w-lg mx-auto space-y-4">
          <h2 className="text-lg font-bold text-cyan-400 flex items-center"><Calendar className="w-5 h-5 mr-2"/> Reserve Your Tour Package</h2>
          {status && <div className="p-3 bg-emerald-950/80 border border-emerald-500 text-emerald-300 text-xs rounded-lg">{status}</div>}
          <form onSubmit={handleBooking} className="space-y-3 text-xs">
            <input required type="text" placeholder="Your Name" value={booking.name} onChange={e => setBooking({...booking, name: e.target.value})} className="w-full bg-gray-900 border border-gray-800 p-2.5 rounded text-white focus:border-cyan-500 outline-none" />
            <input required type="date" value={booking.date} onChange={e => setBooking({...booking, date: e.target.value})} className="w-full bg-gray-900 border border-gray-800 p-2.5 rounded text-white focus:border-cyan-500 outline-none" />
            <button type="submit" className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 font-bold text-white rounded-lg flex items-center justify-center space-x-2">
              <Send className="w-4 h-4" />
              <span>CONFIRM BOOKING ENQUIRY</span>
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}