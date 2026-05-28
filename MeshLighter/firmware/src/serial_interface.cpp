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

        uint8_t *crash = (uint8_t *)0;
        *crash = 0;
        break;
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
