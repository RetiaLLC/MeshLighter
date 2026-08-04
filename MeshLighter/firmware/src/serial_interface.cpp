#include <Arduino.h>

#include "picopb.h"
#include "nvdata.h"

#include <RadioLib.h>


#define BUFFER_LENGTH 300
uint8_t input_buffer[BUFFER_LENGTH];
int input_length = 0;
int frame_length = 0;

void serial_init()
{
}
uint8_t send_buffer[256];

void mt_send(uint8_t *buff, int len);

void serial_send(uint8_t *buffer, int len);

// runtime radio control, defined in main.cpp
void radio_apply_live();
void radio_set_sniff(uint8_t sync, bool crc);
void radio_scan(uint32_t start_khz, uint32_t end_khz, uint32_t step_khz, uint32_t dwell_ms);

void serial_xmit(picopb *pb)
{
  size_t size;
  int id;
  pb_type t;
  //transmit packet
  t = pb->decode_next(&id,&size);
  if(id == 2 && t == pb_type::STRING)
  {
    pb->read_string(send_buffer,256);
    mt_send(send_buffer,size);
  }
}

void serial_config(picopb *pb)
{
  size_t size;
  int id;
  pb_type t;
  uint64_t operation;
  char key[32];
  char value[32];

  //transmit packet
  t = pb->decode_next(&id,&size);
  if(id == 2 && t == pb_type::VARINT)
  {
    pb->read_varint(&operation);
    switch(operation)
    {
      case 0: //read
      case 1:
        t = pb->decode_next(&id,&size);
        if(id == 3 && t == pb_type::STRING)
        {
          if(size > 32)
          {
            size = 32;
          }
          pb->read_string((uint8_t *)key,32);
          key[size] = 0;

        }
        else
        {
          return;
        }
        if(operation == 0)
        {
        delete pb;
          pb = new picopb(send_buffer,256);
          pb->write_varint(1,2);
          pb->write_string(2,(uint8_t *)key,size);
          size = 32;
          if(nvdata.get(key,(uint8_t *)value,(int *)&size)<0)
          {
            size = 0;
          }
          pb->write_string(3,(uint8_t *)value,size);
          serial_send(send_buffer,pb->get_length());
        }
        else
        {
          t = pb->decode_next(&id,&size);
          if(id==4 && t == pb_type::STRING)
          {
            if(size >32)
            {
              size == 32;
            }
            pb->read_string((uint8_t *)value,32);
            nvdata.set(key,(uint8_t *)value,(int)size);
          }
        }
        break;
      case 2:
        Serial.printf("save\n");
        nvdata.save();
        break;
      case 3:
        Serial.printf("should restart\n");
        ESP.restart();
        break;
      case 4:   // #3 apply PHY params live (no reboot)
        radio_apply_live();
        break;
      case 5: { // #5 promiscuous sniff: field3=sync, field4=crc
        uint64_t sync = 0x2B, crc = 1;
        t = pb->decode_next(&id,&size); if(id==3 && t==pb_type::VARINT) pb->read_varint(&sync);
        t = pb->decode_next(&id,&size); if(id==4 && t==pb_type::VARINT) pb->read_varint(&crc);
        radio_set_sniff((uint8_t)sync, crc != 0);
        break;
      }
      case 6: { // #6 spectrum scan: field3=start_khz,4=end_khz,5=step_khz,6=dwell_ms
        uint64_t a=902000, b=928000, s=250, d=25;
        t = pb->decode_next(&id,&size); if(id==3 && t==pb_type::VARINT) pb->read_varint(&a);
        t = pb->decode_next(&id,&size); if(id==4 && t==pb_type::VARINT) pb->read_varint(&b);
        t = pb->decode_next(&id,&size); if(id==5 && t==pb_type::VARINT) pb->read_varint(&s);
        t = pb->decode_next(&id,&size); if(id==6 && t==pb_type::VARINT) pb->read_varint(&d);
        radio_scan((uint32_t)a,(uint32_t)b,(uint32_t)s,(uint32_t)d);
        break;
      }
    }
  }
}

void decode(uint8_t *buff, int len)
{
   int id;
   size_t size;
   pb_type t;
   Serial.printf("decode\n");
   picopb *pb = new picopb(buff,len);
   t = pb->decode_next(&id,&size);
   if(t == pb_type::VARINT)
   {
    if(id == 1)
    {
      uint64_t pktid;
      pb->read_varint(&pktid);
      switch(pktid)
      {
        case 1:
          serial_xmit(pb);
          break;
        case 2:
          serial_config(pb);
          break;
      }
    }
   }
   delete pb;
}

void led_on(int ms);

void serial_update()
{
   while(Serial.available())
   {
      uint8_t inchar = Serial.read();
      switch(input_length)
      {
         case 0:
            if(inchar == 0x94)
            {
               input_buffer[input_length++] = inchar;
            }
            break;
         case 1:
            if(inchar == 0xC3)
            {
               input_buffer[input_length++] = inchar;
            }
            else
            {
               input_length = 0;
            }
            break;
         case 2:
            frame_length = inchar;
            input_buffer[input_length++] = inchar;
            break;
         case 3:
            frame_length <<= 8;
            frame_length |= inchar;
            input_buffer[input_length++] = inchar;
            break;
         default:
            if(input_length < frame_length+4)
            {
               input_buffer[input_length++] = inchar;
            }
            break;
      }
      if(input_length == frame_length + 4)
      {
         led_on(400);
         decode(input_buffer+4,frame_length);
         memset(input_buffer,0,BUFFER_LENGTH);
         input_length = 0;
      }
   }
}

void serial_send(uint8_t *buffer, int len)
{
   Serial.write(0x94);
   Serial.write(0xC3);
   Serial.write(len>>8);
   Serial.write(len);
   Serial.write(buffer,len);
}
