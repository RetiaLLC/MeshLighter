#include <Arduino.h>

#include "nvdata.h"
#define MAX_BLOCKS 16

/*******
 * entry layout: uint8_t klen; uint8_t *key(0 to 62 bytes); uint8_t vlen; uint8_t *val(0 to 64 bytes);
 */



NVData nvdata;

NVData::NVData() {
}

//public code
int NVData::init(char *partname) {
   int i;
   int count = 0;
   num_entries = 0;
   Serial.printf("nvdata init\n");
   part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, partname);

   tempdata = (uint8_t *)malloc(part->erase_size);
   Serial.printf("part size %d erase size %d\n",part->size,part->erase_size);

   numblocks = part->size / part->erase_size;

   if (numblocks > MAX_BLOCKS)
   {
      numblocks = MAX_BLOCKS;
   }
   active_block = -1;
   writecounter = -1;
   for(i=1;i<numblocks;i++)
   {
      Serial.printf("read block %d\n",i);
      block_read(i);
      if((tempdata[0] & 0xC0) == 0x80) //block is valid
      {
         Serial.printf("block valid\n");
         count = tempdata[0] & 0x3F;
         Serial.printf("got count %d\n",count);
         if(writecounter == -1)
         {
            writecounter = count;
            active_block = i;
         }
         else if((count == writecounter + 1) || (writecounter == 63 && count == 0))
         {
            writecounter = count;
            active_block = i;
         }
      }
   }
   if(active_block < 0)
   {
      writecounter = 1;
      active_block = 0;
      block_clear(0);
      block_save(0);
   }
   block_load(active_block);
   writecounter++;
   return 0;
}

int NVData::set(char *key, uint8_t *value, int len) {
   int i;
   int j;
   int keylen = strlen(key);
   if (keylen > 62) {
      keylen = 62;
   }
   if (len > 64) {
      len = 64;
   }
   for (i = 0; i < keylen; i++) {
      tempkey[i] = key[i] & 0x7F;
   }
   for(i = 0; i < num_entries; i++)
   {
      if(keylen != entries[i].klen)
      {
         continue;
      }
      for(j = 0; j < entries[i].klen; j++)
      {
         if(entries[i].key[j] != tempkey[j])
         {
            j = 0;
            break;
         }
      }
      if(j == entries[i].klen)
      {
         if(len != entries[i].vlen)
         {
            entries[i].vlen = len;
            entries[i].val = (uint8_t *)realloc(entries[i].val,len);
         }
         for(j = 0; j < len; j++)
         {
            entries[i].val[j] = value[j];
         }
         return 0;
      }
   }
   if(i == num_entries)
   {
      entries = (NVEntry *)realloc(entries,sizeof(NVEntry)*(num_entries+1));
      entries[num_entries].klen = keylen;
      entries[num_entries].vlen = len;
      entries[num_entries].key = (uint8_t *)malloc(keylen);
      entries[num_entries].val = (uint8_t *)malloc(len);
      memcpy(entries[num_entries].key,tempkey,keylen);
      memcpy(entries[num_entries].val,value,len);
      num_entries++;
      return 0;
   }
   return -1;
}

int NVData::get(char *key, uint8_t *value, int *len) {
   int i;
   int j;
   int keylen = strlen(key);
   if (keylen > 62) {
      keylen = 62;
   }
   if (*len > 64) {
      *len = 64;
   }
   for (i = 0; i < keylen; i++) {
      tempkey[i] = key[i] & 0x7F;
   }
   for(i = 0; i < num_entries; i++)
   {
      if(keylen != entries[i].klen)
      {
         continue;
      }
      for(j = 0; j < entries[i].klen; j++)
      {
         if(entries[i].key[j] != tempkey[j])
         {
            j = 0;
            break;
         }
      }
      if(j == entries[i].klen)
      {
         if(*len > entries[i].vlen)
         {
            *len = entries[i].vlen;
         }
         for(j = 0; j < *len; j++)
         {
            value[j] = entries[i].val[j];
         }
         return 0;
      }
   }
   return -1;
}

int NVData::save()
{
   active_block++;
   if(active_block == numblocks)
   {
      active_block = 0;
   }
   Serial.printf("writing to block %d\n",active_block);
   block_clear(active_block);
   block_save(active_block);
   return 0;
}

//API Wrappers
int NVData::block_read(int block) {
   if (block == current_read_block) {
      return 0;
   }
   esp_partition_read(part, block * part->erase_size, tempdata, part->erase_size);
   current_read_block = block;
   return 0;
}

int NVData::block_write(int block) {
   esp_partition_write(part, block * part->erase_size, tempdata, part->erase_size);
   current_read_block = block;
   return 0;
}

int NVData::block_clear(int block) {
   esp_partition_erase_range(part, block * part->erase_size, part->erase_size);
   return 0;
}


//helpers
int NVData::block_init(int block)
{
   int i;
   block_clear(block);
   for (i = 1; i < part->erase_size; i++)
   {
      tempdata[i] = 0xFF;
   }
   tempdata[0] = (writecounter | 0x80) & 0xBF;
   block_write(block);
   return 0;
}

int NVData::block_load(int block)
{
  int i;
  int readlen=0;
  int index = 1;
   block_read(block);
   while(index < part->erase_size)
   {
      if(tempdata[index] < 0xFF)
      {

        entries = (NVEntry *)realloc(entries,sizeof(NVEntry)*(num_entries+1));
        readlen = tempdata[index++];
        entries[num_entries].klen = readlen;
        entries[num_entries].key = (uint8_t *)malloc(readlen);
        for(i=0;i<readlen;i++)
        {
          entries[num_entries].key[i] = tempdata[index++];
        }
        readlen = tempdata[index++];
        entries[num_entries].vlen = readlen;
        entries[num_entries].val = (uint8_t *)malloc(readlen);
        for(i=0;i<readlen;i++)
        {
          entries[num_entries].val[i] = tempdata[index++];
        }

        num_entries++;
      }
      else
      {
        index = part->erase_size;
      }
   }
   return 0;
}

int NVData::block_save(int block)
{
   int i;
   int j;
   int index = 1;
   for(i=0;i<part->erase_size;i++)
   {
    tempdata[i] = 0xFF;
   }
   tempdata[0] = 0x80 | (writecounter & 0x3F);
   for(i=0;i<num_entries;i++)
   {
      tempdata[index++] = entries[i].klen;
      for(j=0;j<entries[i].klen;j++)
      {
         tempdata[index++] = entries[i].key[j];
      }
      tempdata[index++] = entries[i].vlen;
      for(j=0;j<entries[i].vlen;j++)
      {
         tempdata[index++] = entries[i].val[j];
      }
   }
   writecounter++;
   block_write(block);
   return 0;
}
